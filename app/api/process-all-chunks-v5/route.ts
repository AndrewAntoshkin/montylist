/**
 * Process All Chunks V5 — Orchestrator for V5 BETA
 * 
 * Запускает первые MAX_CONCURRENT чанков и СРАЗУ возвращается.
 * Каждый process-chunk-v5 при завершении запускает следующий pending чанк.
 * Таким образом, поддерживается "worker pool" из MAX_CONCURRENT одновременных запросов.
 * 
 * ПОЛНОСТЬЮ АСИНХРОННАЯ архитектура для избежания HTTP таймаутов.
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { MAX_CONCURRENT_CHUNKS } from '@/lib/config';

export const maxDuration = 60; // Only 60s - we return immediately
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Use internal URL for Railway (HTTP inside container)
  const requestUrl = new URL(request.url);
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
  const savedBaseUrl = isRailway 
    ? `http://localhost:${process.env.PORT || 3000}`
    : `${requestUrl.protocol}//${requestUrl.host}`;
  
  try {
    const { videoId } = await request.json();
    
    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 V5 BETA: Process All Chunks — ${videoId}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Mode: WORKER POOL (async, self-perpetuating)`);
    console.log(`   Max concurrent: ${MAX_CONCURRENT_CHUNKS}`);
    
    const supabase = createServiceRoleClient();
    
    // Get video with chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    if (videoError || !video) {
      throw new Error(`Video not found: ${videoId}`);
    }
    
    const chunkProgress = video.chunk_progress_json;
    
    if (!chunkProgress?.chunks) {
      throw new Error('No chunks found in progress');
    }
    
    console.log(`   Total chunks: ${chunkProgress.totalChunks}`);
    console.log(`   Speaker→Character mappings: ${Object.keys(chunkProgress.speakerCharacterMap || {}).length}`);
    
    // Get pending chunks
    const pendingChunks = chunkProgress.chunks.filter(
      (c: any) => (c.status === 'ready' || c.status === 'pending') && c.storageUrl
    );
    
    console.log(`   Pending chunks: ${pendingChunks.length}`);
    
    if (pendingChunks.length === 0) {
      console.log(`\n✅ All chunks already processed!`);
      return NextResponse.json({
        success: true,
        videoId,
        message: 'All chunks already processed',
        completed: true,
      });
    }
    
    // V5 uses FAL.ai instead of Replicate - no service check needed
    
    // Trigger first MAX_CONCURRENT_CHUNKS chunks
    const initialBatch = pendingChunks.slice(0, MAX_CONCURRENT_CHUNKS);
    
    console.log(`\n🚀 Starting ${initialBatch.length} initial workers...`);
    
    for (const chunk of initialBatch) {
      // Mark as in_progress
      chunkProgress.chunks[chunk.index].status = 'in_progress';
      
      console.log(`   🎬 Starting chunk ${chunk.index + 1}/${chunkProgress.totalChunks}...`);
      
      // Fire and forget
      fetch(`${savedBaseUrl}/api/process-chunk-v5`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          chunkIndex: chunk.index,
          chunkUrl: chunk.storageUrl,
          startTimecode: chunk.startTimecode,
          endTimecode: chunk.endTimecode,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          console.error(`   ❌ Chunk ${chunk.index + 1} failed`);
        }
      }).catch((error) => {
        console.error(`   ❌ Chunk ${chunk.index + 1} network error:`, error.message);
      });
    }
    
    // Save updated progress
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);
    
    console.log(`\n✅ Worker pool started! Each completed chunk will trigger the next.`);
    console.log(`   Remaining chunks (${pendingChunks.length - initialBatch.length}) will be processed automatically.`);
    
    return NextResponse.json({
      success: true,
      videoId,
      message: `Worker pool started with ${initialBatch.length} initial workers`,
      initialWorkers: initialBatch.length,
      totalChunks: chunkProgress.totalChunks,
      pendingChunks: pendingChunks.length,
    });
    
  } catch (error) {
    console.error('❌ Process all chunks V5 error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chunks' },
      { status: 500 }
    );
  }
}
