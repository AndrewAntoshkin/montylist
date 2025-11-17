import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Agent } from 'undici';

const longRequestAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

// Very short timeout - this endpoint just triggers background processing
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Triggers processing of all chunks sequentially
 * This endpoint returns immediately and processing continues in background
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }

    console.log(`🚀 Triggering background processing for all chunks of video ${videoId}`);

    // Get the base URL for internal API calls
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    // Start background processing (fire and forget)
    processAllChunksInBackground(videoId, baseUrl).catch(err => {
      console.error(`❌ Background processing failed for video ${videoId}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: 'Background processing started',
      videoId,
    });

  } catch (error) {
    console.error('Error triggering chunk processing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Background function that processes all chunks in parallel batches
 */
async function processAllChunksInBackground(videoId: string, baseUrl: string) {
  try {
    console.log(`📦 Starting background processing for video ${videoId}`);

    // Use Service Role to access database directly (no auth needed)
    const supabase = createServiceRoleClient();

    // Fetch video data to get chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error(`Failed to fetch video data: ${videoError?.message}`);
    }

    const chunkProgress = video.chunk_progress_json;

    if (!chunkProgress || !chunkProgress.chunks) {
      throw new Error('No chunk progress found');
    }

    const chunks = chunkProgress.chunks;
    console.log(`📊 Found ${chunks.length} chunks to process`);

    // Filter out already completed chunks
    const pendingChunks = chunks.filter((chunk: any) => chunk.status !== 'completed');
    
    if (pendingChunks.length === 0) {
      console.log(`✅ All chunks already completed`);
      return;
    }

    console.log(`🚀 Processing ${pendingChunks.length} chunks sequentially (one by one for stability)...`);

    // Process each chunk SEQUENTIALLY (not in parallel)
    // This is slower but more stable and works better with Gemini
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pendingChunks.length; i++) {
      const chunk = pendingChunks[i];
      
      console.log(`\n📦 Processing chunk ${i + 1}/${pendingChunks.length} (chunk index: ${chunk.index})`);

      try {
        // Validate chunk data
        if (!chunk.storageUrl) {
          throw new Error(`Chunk ${chunk.index} has no storage URL. Init may have failed.`);
        }

        console.log(`🎬 Starting chunk ${chunk.index} for video ${videoId}...`);

        const chunkResponse = await fetch(`${baseUrl}/api/process-chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: chunk.index,
            chunkStorageUrl: chunk.storageUrl,
            startTimecode: chunk.startTimecode,
            endTimecode: chunk.endTimecode,
          }),
          // Replicate processing может занимать 5+ минут, поэтому снимаем таймауты
          dispatcher: longRequestAgent,
        });

        if (!chunkResponse.ok) {
          const error = await chunkResponse.json();
          throw new Error(`Failed to process chunk ${chunk.index}: ${error.error}`);
        }

        const chunkData = await chunkResponse.json();
        console.log(`✅ Chunk ${chunk.index} completed: ${chunkData.scenesCount} scenes`);
        successCount++;
        
      } catch (error) {
        console.error(`❌ Chunk ${chunk.index} failed:`, error);
        failCount++;
        
        // Continue processing other chunks even if one fails
        console.log(`⚠️  Continuing to next chunk despite error...`);
      }
    }

    console.log(`\n📊 Sequential processing completed: ${successCount} successful, ${failCount} failed`);

    console.log(`🎉 All chunks processed for video ${videoId}, starting finalization...`);

    // Finalize processing
    const finalizeResponse = await fetch(`${baseUrl}/api/finalize-processing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json();
      throw new Error(`Failed to finalize: ${error.error}`);
    }

    const finalizeData = await finalizeResponse.json();
    console.log(`🎊 Video ${videoId} processing completed! Total entries: ${finalizeData.totalEntries}`);

  } catch (error) {
    console.error(`❌ Background processing error for video ${videoId}:`, error);
    throw error;
  }
}

