/**
 * Process All Chunks V5 — Orchestrator for V5 BETA
 * 
 * Запускает обработку чанков с ОГРАНИЧЕННОЙ параллельностью.
 * MAX_CONCURRENT = количество API ключей в пуле (3-4).
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 900; // 15 min for ~16 chunks
export const dynamic = 'force-dynamic';

// Максимум одновременных запросов = количество API ключей
const MAX_CONCURRENT = 3;

interface ChunkResult {
  chunkIndex: number;
  success: boolean;
  error?: string;
}

async function processChunk(
  baseUrl: string,
  videoId: string,
  chunk: any,
  totalChunks: number
): Promise<ChunkResult> {
  const chunkIndex = chunk.index;
  
  try {
    console.log(`   🎬 Processing chunk ${chunkIndex + 1}/${totalChunks}...`);
    
    const response = await fetch(`${baseUrl}/api/process-chunk-v5`, {
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
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`   ✅ Chunk ${chunkIndex + 1} done: ${result.plansCreated || 0} plans`);
    
    return { chunkIndex, success: true };
  } catch (error) {
    console.error(`   ❌ Chunk ${chunkIndex + 1} failed:`, error);
    return { 
      chunkIndex, 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

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
    console.log(`   Max concurrent: ${MAX_CONCURRENT} (matching API key pool)`);
    
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
    
    // Get pending chunks
    const pendingChunks = chunkProgress.chunks.filter(
      (c: any) => (c.status === 'ready' || c.status === 'pending') && c.storageUrl
    );
    
    console.log(`\n🚀 Processing ${pendingChunks.length} chunks (max ${MAX_CONCURRENT} parallel)...`);
    
    // Process chunks with limited concurrency
    const results: ChunkResult[] = [];
    
    for (let i = 0; i < pendingChunks.length; i += MAX_CONCURRENT) {
      const batch = pendingChunks.slice(i, i + MAX_CONCURRENT);
      const batchNum = Math.floor(i / MAX_CONCURRENT) + 1;
      const totalBatches = Math.ceil(pendingChunks.length / MAX_CONCURRENT);
      
      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (chunks ${i + 1}-${Math.min(i + MAX_CONCURRENT, pendingChunks.length)})`);
      
      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(chunk => 
          processChunk(savedBaseUrl, videoId, chunk, chunkProgress.totalChunks)
        )
      );
      
      results.push(...batchResults);
    }
    
    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 V5 BETA COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   ✅ Successful: ${successful}/${pendingChunks.length}`);
    if (failed > 0) {
      console.log(`   ❌ Failed: ${failed}`);
      results.filter(r => !r.success).forEach(r => {
        console.log(`      Chunk ${r.chunkIndex}: ${r.error}`);
      });
    }
    
    return NextResponse.json({
      success: failed === 0,
      videoId,
      processedChunks: successful,
      failedChunks: failed,
      results,
    });
    
  } catch (error) {
    console.error('❌ Process all chunks V5 error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chunks' },
      { status: 500 }
    );
  }
}
