/**
 * Process All Chunks V5 — Orchestrator for V5 BETA
 * 
 * Запускает обработку всех чанков последовательно.
 * Использует speaker→character mapping из init-processing-v5.
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const savedBaseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  
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
    console.log(`   Architecture: ${chunkProgress.architecture}`);
    
    // Process chunks sequentially
    const pendingChunks = chunkProgress.chunks.filter(
      (c: any) => c.status === 'ready' || c.status === 'pending'
    );
    
    console.log(`\n🚀 Processing ${pendingChunks.length} chunks...`);
    
    for (const chunk of pendingChunks) {
      if (!chunk.storageUrl) {
        console.log(`   ⚠️ Chunk ${chunk.index} has no storage URL, skipping`);
        continue;
      }
      
      console.log(`\n📦 Processing chunk ${chunk.index + 1}/${chunkProgress.totalChunks}...`);
      
      try {
        const response = await fetch(`${savedBaseUrl}/api/process-chunk-v5`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: chunk.index,
            chunkUrl: chunk.storageUrl,
            startTimecode: chunk.startTimecode,
            endTimecode: chunk.endTimecode,
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`   ❌ Chunk ${chunk.index} failed:`, errorData);
        } else {
          const result = await response.json();
          console.log(`   ✅ Chunk ${chunk.index} complete: ${result.plansCreated || 0} plans`);
        }
        
      } catch (chunkError) {
        console.error(`   ❌ Chunk ${chunk.index} error:`, chunkError);
      }
    }
    
    // Finalize
    console.log(`\n🏁 Finalizing video...`);
    
    try {
      await fetch(`${savedBaseUrl}/api/finalize-processing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
    } catch (finalizeError) {
      console.error('Finalize error:', finalizeError);
    }
    
    console.log(`\n✅ V5 BETA: All chunks processed for ${videoId}`);
    
    return NextResponse.json({
      success: true,
      videoId,
      processedChunks: pendingChunks.length,
    });
    
  } catch (error) {
    console.error('❌ Process all chunks V5 error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chunks' },
      { status: 500 }
    );
  }
}
