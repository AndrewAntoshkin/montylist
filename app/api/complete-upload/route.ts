import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks } from '@/lib/video-chunking';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Completes the upload process after file is uploaded directly to Supabase Storage
 * Creates video record and optionally starts processing
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      storagePath, 
      originalFilename, 
      fileSize, 
      duration,
      skipAutoProcess,
      filmMetadata 
    } = await request.json();

    if (!storagePath || !originalFilename) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log(`✅ Completing upload for: ${originalFilename}`);

    console.log('📝 Film metadata:', filmMetadata ? JSON.stringify(filmMetadata) : 'none');

    // Create video record in database
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        filename: storagePath.split('/').pop(),
        original_filename: originalFilename,
        storage_path: storagePath,
        file_size: fileSize,
        duration: duration ? parseInt(duration) : null,
        status: 'uploading',
        film_metadata_json: filmMetadata, // Сохраняем метаданные фильма
      })
      .select()
      .single();

    if (videoError || !video) {
      console.error('Error creating video record:', videoError);
      return NextResponse.json(
        { error: 'Failed to create video record' },
        { status: 500 }
      );
    }

    console.log(`📹 Video record created: ${video.id}`);

    // Check if video is long (>20 minutes) and should use chunked processing
    const videoDuration = duration ? parseInt(duration) : 0;
    const isLongVideo = videoDuration > 1200;

    if (skipAutoProcess === 'true' || isLongVideo) {
      console.log(
        `Skipping auto-process for video: ${video.id} (will be processed via chunked endpoint)`
      );
      
      // Update status to processing (chunked processing will be triggered from client)
      await supabase
        .from('videos')
        .update({ status: 'processing' })
        .eq('id', video.id);
      
      return NextResponse.json({
        success: true,
        video,
        needsChunkedProcessing: true,
      });
    }

    // For short videos, trigger immediate processing
    console.log(`Starting immediate processing for short video: ${video.id}`);
    
    // Update to processing status
    await supabase
      .from('videos')
      .update({ status: 'processing' })
      .eq('id', video.id);

    // Trigger processing (will use /api/process-video)
    return NextResponse.json({
      success: true,
      video,
      needsChunkedProcessing: false,
    });

  } catch (error) {
    console.error('Error in complete-upload:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

