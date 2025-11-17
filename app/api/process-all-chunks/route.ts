import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
 * Background function that processes all chunks sequentially
 */
async function processAllChunksInBackground(videoId: string, baseUrl: string) {
  try {
    console.log(`📦 Starting background processing for video ${videoId}`);

    // Fetch video data to get chunk progress
    const videoResponse = await fetch(`${baseUrl}/api/videos/${videoId}`);
    if (!videoResponse.ok) {
      throw new Error('Failed to fetch video data');
    }

    const videoData = await videoResponse.json();
    const chunkProgress = videoData.chunk_progress_json;

    if (!chunkProgress || !chunkProgress.chunks) {
      throw new Error('No chunk progress found');
    }

    const chunks = chunkProgress.chunks;
    console.log(`📊 Found ${chunks.length} chunks to process`);

    // Process each chunk sequentially
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      if (chunk.status === 'completed') {
        console.log(`⏭️  Chunk ${i} already completed, skipping`);
        continue;
      }

      console.log(`🎬 Processing chunk ${i + 1}/${chunks.length}...`);

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
      });

      if (!chunkResponse.ok) {
        const error = await chunkResponse.json();
        console.error(`❌ Chunk ${i} failed:`, error);
        throw new Error(`Failed to process chunk ${i}: ${error.error}`);
      }

      const chunkData = await chunkResponse.json();
      console.log(`✅ Chunk ${i + 1}/${chunks.length} completed: ${chunkData.scenesCount} scenes`);
    }

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

