/**
 * Process All Chunks V4 — с PySceneDetect
 * 
 * Использует process-chunk-v4 с более точными таймкодами
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
    console.log(`🚀 V4 PROCESSING (PySceneDetect): Starting for video ${videoId}`);
    console.log(`${'═'.repeat(60)}`);

    // ALWAYS use request.url for correct port (env var can be stale)
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    console.log(`🌐 Base URL: ${baseUrl}`);

    // Start background processing
    processChunksV4(videoId, baseUrl).catch(err => {
      console.error(`❌ V4 processing failed for ${videoId}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: 'V4 processing started (PySceneDetect)',
      videoId,
    });

  } catch (error) {
    console.error('V4 trigger error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Последовательная обработка чанков с V4 (PySceneDetect)
 */
async function processChunksV4(videoId: string, baseUrl: string) {
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
    const sceneDetector = chunkProgress.sceneDetector || 'pyscenedetect';
    console.log(`\n📊 V4 (${sceneDetector}): Processing ${chunks.length} chunks sequentially`);

    let successCount = 0;
    let failCount = 0;
    const failedChunks: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📦 V4 CHUNK ${i + 1}/${chunks.length}`);
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

      // Retry loop для quality issues (422)
      const MAX_QUALITY_RETRIES = 3;
      let qualityRetryCount = 0;
      let chunkSuccess = false;
      
      while (!chunkSuccess && qualityRetryCount < MAX_QUALITY_RETRIES) {
        try {
          if (qualityRetryCount > 0) {
            console.log(`   🔄 Quality retry ${qualityRetryCount}/${MAX_QUALITY_RETRIES}...`);
            // Увеличиваем паузу перед retry
            await new Promise(resolve => setTimeout(resolve, 3000 * qualityRetryCount));
          } else {
            console.log(`   🚀 Sending to V4 AI (PySceneDetect timecodes)...`);
          }
          
          // Используем V4 endpoint!
          const chunkResponse = await fetch(`${baseUrl}/api/process-chunk-v4`, {
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

          // 422 = Quality check failed, needs retry
          if (chunkResponse.status === 422) {
            const errorData = await chunkResponse.json();
            console.warn(`   ⚠️ Quality check failed (score: ${errorData.qualityScore || '?'}/100)`);
            for (const issue of (errorData.issues || [])) {
              console.warn(`      - ${issue}`);
            }
            qualityRetryCount++;
            
            if (qualityRetryCount >= MAX_QUALITY_RETRIES) {
              console.error(`   ❌ Max quality retries reached, accepting current result`);
              // Пробуем ещё раз и принимаем что есть
              failCount++;
              failedChunks.push(chunk);
            }
            continue;
          }

          if (!chunkResponse.ok) {
            const error = await chunkResponse.json();
            throw new Error(`V4 chunk failed: ${error.error}`);
          }

          const chunkData = await chunkResponse.json();
          console.log(`   ✅ V4 OK: ${chunkData.scenesCount} scenes${qualityRetryCount > 0 ? ` (after ${qualityRetryCount} retries)` : ''}`);
          successCount++;
          chunkSuccess = true;
          
        } catch (error) {
          console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
          qualityRetryCount++;
          
          if (qualityRetryCount >= MAX_QUALITY_RETRIES) {
            failCount++;
            failedChunks.push(chunk);
          }
        }
      }
      
      // Small pause between chunks
      if (i < chunks.length - 1) {
        console.log(`   ⏳ Waiting 1s...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Retry failed chunks once
    if (failedChunks.length > 0 && failedChunks.length <= 5) {
      console.log(`\n🔄 V4 RETRY: ${failedChunks.length} failed chunks...`);
      
      for (const chunk of failedChunks) {
        try {
          console.log(`   🔄 Retrying chunk ${chunk.index}...`);
          
          const chunkResponse = await fetch(`${baseUrl}/api/process-chunk-v4`, {
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
    console.log(`📊 V4 PROCESSING COMPLETE (PySceneDetect)`);
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
    console.log(`🎊 V4 DONE! Total entries: ${finalizeData.totalEntries}`);

  } catch (error) {
    console.error(`❌ V4 processing error for ${videoId}:`, error);
    throw error;
  }
}

