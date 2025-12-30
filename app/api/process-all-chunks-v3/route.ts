/**
 * Process All Chunks V3 — упрощённая последовательная обработка
 * 
 * Использует process-chunk-v3 с упрощёнными промптами
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Agent } from 'undici';

const longRequestAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🚀 V3 PROCESSING: Starting for video ${videoId}`);
    console.log(`${'═'.repeat(60)}`);

    const host = request.headers.get('host') || 'localhost:3001';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;
    
    console.log(`🌐 Base URL: ${baseUrl}`);

    // Start background processing
    processChunksV3(videoId, baseUrl).catch(err => {
      console.error(`❌ V3 processing failed for ${videoId}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: 'V3 processing started',
      videoId,
    });

  } catch (error) {
    console.error('V3 trigger error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Последовательная обработка чанков с V3 промптами
 */
async function processChunksV3(videoId: string, baseUrl: string) {
  try {
    const supabase = createServiceRoleClient();

    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error(`Video not found: ${videoError?.message}`);
    }

    const chunkProgress = video.chunk_progress_json;

    if (!chunkProgress || !chunkProgress.chunks) {
      throw new Error('No chunks found');
    }

    const chunks = chunkProgress.chunks;
    console.log(`\n📊 V3: Processing ${chunks.length} chunks sequentially`);

    let successCount = 0;
    let failCount = 0;
    const failedChunks: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📦 V3 CHUNK ${i + 1}/${chunks.length}`);
      console.log(`   ${chunk.startTimecode} → ${chunk.endTimecode}`);
      console.log(`${'─'.repeat(50)}`);
      
      // Skip completed
      if (chunk.status === 'completed') {
        console.log(`   ✅ Already completed`);
        successCount++;
        continue;
      }
      
      // Skip processing
      if (chunk.status === 'processing') {
        console.log(`   ⚠️ Already processing`);
        continue;
      }
      
      // Skip no URL
      if (!chunk.storageUrl) {
        console.log(`   ❌ No storage URL`);
        failCount++;
        continue;
      }

      try {
        console.log(`   🚀 Sending to V3 AI...`);
        
        // Используем V3 endpoint!
        const chunkResponse = await fetch(`${baseUrl}/api/process-chunk-v3`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: chunk.index,
            chunkStorageUrl: chunk.storageUrl,
            startTimecode: chunk.startTimecode,
            endTimecode: chunk.endTimecode,
          }),
          dispatcher: longRequestAgent,
        } as any);

        if (!chunkResponse.ok) {
          const error = await chunkResponse.json();
          throw new Error(`V3 chunk failed: ${error.error}`);
        }

        const chunkData = await chunkResponse.json();
        console.log(`   ✅ V3 OK: ${chunkData.scenesCount} scenes`);
        successCount++;
        
        // Small pause between chunks
        if (i < chunks.length - 1) {
          console.log(`   ⏳ Waiting 1s...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
        failCount++;
        failedChunks.push(chunk);
        continue;
      }
    }

    // Retry failed chunks once
    if (failedChunks.length > 0 && failedChunks.length <= 5) {
      console.log(`\n🔄 V3 RETRY: ${failedChunks.length} failed chunks...`);
      
      for (const chunk of failedChunks) {
        try {
          console.log(`   🔄 Retrying chunk ${chunk.index}...`);
          
          const chunkResponse = await fetch(`${baseUrl}/api/process-chunk-v3`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId,
              chunkIndex: chunk.index,
              chunkStorageUrl: chunk.storageUrl,
              startTimecode: chunk.startTimecode,
              endTimecode: chunk.endTimecode,
            }),
            dispatcher: longRequestAgent,
          } as any);

          if (chunkResponse.ok) {
            const chunkData = await chunkResponse.json();
            console.log(`   ✅ Retry OK: ${chunkData.scenesCount} scenes`);
            successCount++;
            failCount--;
          }
        } catch (error) {
          console.error(`   ❌ Retry failed:`, error);
        }
      }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 V3 PROCESSING COMPLETE`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`${'═'.repeat(60)}`);

    // Finalize
    console.log(`\n🎉 Finalizing...`);

    const finalizeResponse = await fetch(`${baseUrl}/api/finalize-processing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json();
      throw new Error(`Finalize failed: ${error.error}`);
    }

    const finalizeData = await finalizeResponse.json();
    console.log(`🎊 V3 DONE! Total entries: ${finalizeData.totalEntries}`);

  } catch (error) {
    console.error(`❌ V3 processing error for ${videoId}:`, error);
    throw error;
  }
}

