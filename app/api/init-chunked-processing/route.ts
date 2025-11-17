import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks, secondsToTimecode } from '@/lib/video-chunking';
import { downloadVideo, splitVideoIntoChunks, cleanupTempFiles } from '@/lib/video-splitter';
import path from 'path';
import fs from 'fs';

// 5 minutes timeout for initialization (downloading + splitting video)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];
  
  try {
    const { videoId, videoUrl, videoDuration } = await request.json();

    if (!videoId || !videoUrl || !videoDuration) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, videoUrl, videoDuration' },
        { status: 400 }
      );
    }

    console.log(`🎬 Initializing chunked processing for video ${videoId} (${videoDuration}s)`);

    const supabase = createServiceRoleClient();

    // Update video status to processing
    await supabase
      .from('videos')
      .update({ status: 'processing' })
      .eq('id', videoId);

    // Create chunks based on video duration
    const chunks = createVideoChunks(videoDuration);
    console.log(`📦 Created ${chunks.length} chunks`);

    // Get video record
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('user_id')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    // Create montage sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('montage_sheets')
      .insert({
        video_id: videoId,
        user_id: video.user_id,
        title: `Монтажный лист (${chunks.length} частей)`,
      })
      .select()
      .single();

    if (sheetError || !sheet) {
      console.error('Error creating sheet:', sheetError);
      throw new Error('Failed to create montage sheet');
    }

    // Initialize chunk progress
    const chunkProgress = {
      totalChunks: chunks.length,
      completedChunks: 0,
      currentChunk: 0,
      sheetId: sheet.id,
      chunks: chunks.map(chunk => ({
        index: chunk.chunkIndex,
        status: 'pending' as const,
        startTimecode: chunk.startTimecode,
        endTimecode: chunk.endTimecode,
        storageUrl: null as string | null,
      })),
    };

    // Download original video to temp location
    const tempDir = '/tmp/video-chunks';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const originalVideoPath = path.join(tempDir, `original_${videoId}.mp4`);
    console.log(`📥 Downloading original video...`);
    await downloadVideo(videoUrl, originalVideoPath);
    tempFiles.push(originalVideoPath);
    
    // Split video into chunks
    console.log(`✂️  Splitting video into ${chunks.length} chunks...`);
    const chunkFiles = await splitVideoIntoChunks(
      originalVideoPath,
      chunks.map(c => ({
        chunkIndex: c.chunkIndex,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
      tempDir
    );
    
    tempFiles.push(...chunkFiles.map(c => c.localPath));
    
    // Upload each chunk to Supabase Storage
    console.log(`☁️  Uploading ${chunkFiles.length} chunks to storage...`);
    
    for (const chunkFile of chunkFiles) {
      const chunkStoragePath = `${video.user_id}/chunks/chunk_${chunkFile.chunkIndex}_${Date.now()}.mp4`;
      
      const chunkBuffer = fs.readFileSync(chunkFile.localPath);
      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(chunkStoragePath, chunkBuffer, {
          contentType: 'video/mp4',
          upsert: false,
        });

      if (uploadError) {
        console.error(`Error uploading chunk ${chunkFile.chunkIndex}:`, uploadError);
        throw new Error(`Failed to upload chunk ${chunkFile.chunkIndex}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('videos')
        .getPublicUrl(chunkStoragePath);

      // Update chunk progress with storage URL
      chunkProgress.chunks[chunkFile.chunkIndex].storageUrl = urlData.publicUrl;
      
      console.log(`✅ Chunk ${chunkFile.chunkIndex + 1}/${chunkFiles.length} uploaded`);
    }

    // Save chunk progress with storage URLs
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    // Cleanup temp files
    console.log('🧹 Cleaning up temporary files...');
    cleanupTempFiles(tempFiles);

    console.log(`✅ Initialization complete. Ready to process ${chunks.length} chunks`);

    return NextResponse.json({
      success: true,
      videoId,
      sheetId: sheet.id,
      chunks: chunkProgress.chunks.map(c => ({
        index: c.index,
        startTimecode: c.startTimecode,
        endTimecode: c.endTimecode,
        storageUrl: c.storageUrl,
        status: c.status,
      })),
      totalChunks: chunks.length,
    });

  } catch (error) {
    console.error('Error initializing chunked processing:', error);
    
    // Cleanup on error
    if (tempFiles.length > 0) {
      try {
        cleanupTempFiles(tempFiles);
      } catch (cleanupError) {
        console.error('Error cleaning up temp files:', cleanupError);
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

