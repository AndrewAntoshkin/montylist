import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks } from '@/lib/video-chunking';

// Увеличиваем лимит размера тела запроса до 100MB
export const maxDuration = 60; // 60 секунд таймаут
export const dynamic = 'force-dynamic';

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

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    const duration = formData.get('duration') as string | null;
    const skipAutoProcess = formData.get('skipAutoProcess') as string | null; // для chunked процесса
    const filmMetadataStr = formData.get('filmMetadata') as string | null;
    const filmMetadata = filmMetadataStr ? JSON.parse(filmMetadataStr) : null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate user ID matches authenticated user
    if (userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop();
    const filename = `${timestamp}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const storagePath = `${user.id}/${filename}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Prepare chunk progress if this is a long video
    const videoDuration = duration ? parseInt(duration, 10) : null;
    let chunkProgress = null;
    
    if (videoDuration && videoDuration > 1200) {
      // Video is longer than 20 minutes - initialize chunk progress
      const chunks = createVideoChunks(videoDuration);
      chunkProgress = {
        totalChunks: chunks.length,
        completedChunks: 0,
        currentChunk: 0,
        chunks: chunks.map(chunk => ({
          index: chunk.chunkIndex,
          status: 'pending' as const,
          startTimecode: chunk.startTimecode,
          endTimecode: chunk.endTimecode,
        })),
      };
    }

    // Create video record in database
    const { data: video, error: dbError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        filename: filename,
        original_filename: file.name,
        storage_path: storagePath,
        file_size: file.size,
        duration: videoDuration,
        status: 'processing',
        chunk_progress_json: chunkProgress,
        film_metadata_json: filmMetadata,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file if DB insert fails
      await supabase.storage.from('videos').remove([storagePath]);
      return NextResponse.json(
        { error: 'Failed to create video record' },
        { status: 500 }
      );
    }

    // Trigger video processing (только если не пропущен для ручного chunked процесса)
    if (!skipAutoProcess || skipAutoProcess !== 'true') {
      try {
        // Use Service Role client to create a signed URL that Replicate can access
        const serviceClient = createServiceRoleClient();
        const { data: urlData, error: urlError } = await serviceClient.storage
          .from('videos')
          .createSignedUrl(storagePath, 7200); // 2 hours expiry for processing

        if (urlError) {
          console.error('Error creating signed URL:', urlError);
          throw urlError;
        }

        if (urlData?.signedUrl) {
          console.log('Created signed URL for video:', video.id);
          console.log('URL:', urlData.signedUrl);
          
          // Trigger processing in background (don't await)
          fetch(`${request.nextUrl.origin}/api/process-video`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              videoId: video.id,
              videoUrl: urlData.signedUrl,
            }),
          }).catch((error) => {
            console.error('Failed to trigger processing:', error);
          });
        } else {
          console.error('Failed to create signed URL for video');
        }
      } catch (error) {
        console.error('Error triggering processing:', error);
        // Don't fail the upload, just log the error
      }
    } else {
      console.log('Skipping auto-process for video:', video.id, '(will be processed via chunked endpoint)');
    }

    return NextResponse.json({
      success: true,
      video,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


