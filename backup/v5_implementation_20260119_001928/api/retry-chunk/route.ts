import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Manual retry endpoint for failed chunks
 * POST /api/retry-chunk
 * Body: { videoId, chunkIndex }
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId, chunkIndex } = await request.json();

    if (!videoId || chunkIndex === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, chunkIndex' },
        { status: 400 }
      );
    }

    console.log(`🔄 Manual retry requested for video ${videoId}, chunk ${chunkIndex}`);

    const supabase = createServiceRoleClient();

    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    const chunkProgress = video.chunk_progress_json;
    if (!chunkProgress || !chunkProgress.chunks[chunkIndex]) {
      return NextResponse.json(
        { error: 'Chunk not found' },
        { status: 404 }
      );
    }

    const chunk = chunkProgress.chunks[chunkIndex];

    // Reset chunk status to pending
    chunkProgress.chunks[chunkIndex] = {
      ...chunk,
      status: 'pending',
      error: undefined,
    };

    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    console.log(`✅ Chunk ${chunkIndex} status reset to pending`);

    // Trigger processing for this specific chunk
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 
      `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}`;

    console.log(`🚀 Triggering processing for chunk ${chunkIndex}`);

    const processResponse = await fetch(`${baseUrl}/api/process-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        chunkIndex,
        chunkStorageUrl: chunk.storageUrl,
        startTimecode: chunk.startTimecode,
        endTimecode: chunk.endTimecode,
      }),
    });

    if (!processResponse.ok) {
      const errorText = await processResponse.text();
      console.error(`❌ Failed to process chunk ${chunkIndex}:`, errorText);
      return NextResponse.json(
        { error: `Failed to process chunk: ${errorText}` },
        { status: 500 }
      );
    }

    const result = await processResponse.json();
    console.log(`✅ Chunk ${chunkIndex} processing started`);

    return NextResponse.json({
      success: true,
      message: `Chunk ${chunkIndex} retry started`,
      result,
    });

  } catch (error) {
    console.error('Error retrying chunk:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}












