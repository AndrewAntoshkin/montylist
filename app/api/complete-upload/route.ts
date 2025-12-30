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
      filmMetadata,
      scriptData 
    } = await request.json();

    if (!storagePath || !originalFilename) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log(`✅ Completing upload for: ${originalFilename}`);

    console.log('📝 Film metadata:', filmMetadata ? JSON.stringify(filmMetadata) : 'none');
    
    // Log script data if present
    if (scriptData?.characters?.length > 0) {
      console.log(`📋 Script loaded: ${scriptData.characters.length} characters`);
      const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      if (mainChars.length > 0) {
        console.log(`   🌟 Main characters: ${mainChars.map((c: any) => c.name).join(', ')}`);
      }
    }

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
        `Video ${video.id} needs chunked processing (duration: ${videoDuration}s)`
      );
      
      // Check if already being processed (prevent duplicate initialization)
      // Check both montage sheet AND chunk_progress (more reliable)
      const { data: currentVideo } = await supabase
        .from('videos')
        .select('chunk_progress_json')
        .eq('id', video.id)
        .single();
      
      if (currentVideo?.chunk_progress_json) {
        console.log(`⚠️  Video ${video.id} already has chunk progress, skipping duplicate initialization`);
        return NextResponse.json({
          success: true,
          videoId: video.id,
          message: 'Video already initialized (duplicate request detected)',
          alreadyProcessing: true,
        });
      }
      
      // Also check montage sheet
      const { data: existingSheet } = await supabase
        .from('montage_sheets')
        .select('id')
        .eq('video_id', video.id)
        .maybeSingle();
      
      if (existingSheet) {
        console.log(`⚠️  Montage sheet already exists for video ${video.id}, skipping duplicate initialization`);
        return NextResponse.json({
          success: true,
          videoId: video.id,
          sheetId: existingSheet.id,
          message: 'Video already initialized (duplicate request detected)',
          alreadyProcessing: true,
        });
      }
      
      // Atomic update: only change from 'uploading' to 'processing'
      // This prevents duplicate initialization (race condition protection)
      const { data: updateResult, error: updateError } = await supabase
        .from('videos')
        .update({ status: 'processing' })
        .eq('id', video.id)
        .eq('status', 'uploading') // Only update if status is still 'uploading'
        .select();
      
      // If no rows updated, another request already changed status
      if (!updateResult || updateResult.length === 0) {
        console.log(`⚠️  Video ${video.id} already being processed by another request`);
        return NextResponse.json({
          success: true,
          videoId: video.id,
          message: 'Video initialization already in progress',
          alreadyProcessing: true,
        });
      }
      
      console.log(`🔒 Acquired processing lock for video ${video.id}`);
      
      // Get signed URL for the uploaded video (for external API access)
      // TUS upload может завершиться, но файл ещё не доступен сразу — добавляем retry
      // Для больших файлов (>100MB) Supabase может занимать до 30+ секунд на финализацию
      let signedUrlData: { signedUrl: string } | null = null;
      let urlError: Error | null = null;
      const maxRetries = 15; // Увеличено для больших файлов
      
      console.log(`🔍 Checking file availability at: ${storagePath}`);
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await supabase.storage
          .from('videos')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days
        
        if (result.data && !result.error) {
          signedUrlData = result.data;
          urlError = null;
          console.log(`✅ Signed URL created on attempt ${attempt}`);
          break;
        }
        
        urlError = result.error;
        console.log(`⏳ Attempt ${attempt}/${maxRetries}: File not ready yet (${result.error?.message || 'unknown'}), waiting ${attempt * 2}s...`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // 2s, 4s, 6s... (progressive backoff)
        }
      }
      
      if (urlError || !signedUrlData) {
        console.error(`❌ Failed to create signed URL for video ${video.id} after ${maxRetries} attempts:`, urlError);
        return NextResponse.json(
          { error: 'Failed to create video URL for processing. File may not be fully uploaded.' },
          { status: 500 }
        );
      }
      
      const videoUrl = signedUrlData.signedUrl;
      
      // Check if this is V3/V4 processing - if so, don't auto-trigger, let client handle it
      const processingVersion = filmMetadata?.processingVersion;
      const isClientSideInit = processingVersion === 'v3' || processingVersion === 'v4';
      
      if (isClientSideInit) {
        console.log(`🎯 ${processingVersion?.toUpperCase()} mode: returning URL for client-side init`);
        return NextResponse.json({
          success: true,
          video,
          videoUrl: videoUrl, // Return URL for client to use
          videoDuration: videoDuration,
          needsChunkedProcessing: true,
          processingVersion: processingVersion,
        });
      }
      
      // V4: Trigger PySceneDetect processing automatically (fire and forget)
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}`;
      
      console.log(`🚀 Triggering V4 (PySceneDetect) processing for video ${video.id}...`);
      
      fetch(`${baseUrl}/api/init-processing-v4`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoId: video.id,
          videoUrl: videoUrl,
          videoDuration: videoDuration,
          filmMetadata: filmMetadata,
          scriptData: scriptData, // Передаём данные сценария
        }),
      }).catch(err => {
        console.error(`❌ Failed to trigger V4 processing for video ${video.id}:`, err);
      });
      
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

