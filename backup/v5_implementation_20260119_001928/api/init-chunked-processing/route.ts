import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks, secondsToTimecode } from '@/lib/video-chunking';
import { downloadVideo, splitVideoIntoChunks, cleanupTempFiles } from '@/lib/video-splitter';
import { detectScenes, validateFFmpeg, detectVideoFPS } from '@/lib/scene-detection';
import { mergeCreditsScenes, type MergedScene } from '@/lib/credits-detector';
import path from 'path';
import fs from 'fs';

// 5 minutes timeout for initialization (downloading + splitting video + optional scene detection)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];
  
  try {
    const { videoId, videoUrl, videoDuration, filmMetadata, scriptData } = await request.json();

    if (!videoId || !videoUrl || !videoDuration) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, videoUrl, videoDuration' },
        { status: 400 }
      );
    }

    console.log(`🎬 Initializing chunked processing for video ${videoId} (${videoDuration}s)`);
    
    // Log script data if present
    if (scriptData?.characters?.length > 0) {
      console.log(`📋 СЦЕНАРИЙ ЗАГРУЖЕН: ${scriptData.characters.length} персонажей`);
      const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      if (mainChars.length > 0) {
        console.log(`   🌟 Главные: ${mainChars.map((c: any) => c.name).join(', ')}`);
      }
    }

    const supabase = createServiceRoleClient();

    // CRITICAL: Atomic check-and-set to prevent duplicate initialization
    // Try to update status from 'processing' to 'processing' ONLY if chunk_progress_json is NULL
    // This acts as a distributed lock
    const { data: lockResult, error: lockError } = await supabase
      .from('videos')
      .update({ 
        status: 'processing',
        chunk_progress_json: { initializing: true, timestamp: new Date().toISOString() }
      })
      .eq('id', videoId)
      .eq('status', 'processing')
      .is('chunk_progress_json', null) // Only proceed if chunks NOT already being initialized
      .select('user_id');

    // If no rows updated, another request is already initializing
    if (!lockResult || lockResult.length === 0) {
      console.log(`⚠️  Video ${videoId} is already being initialized by another request, exiting`);
      
      // Try to get existing data
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('chunk_progress_json')
        .eq('id', videoId)
        .single();
      
      const { data: existingSheet } = await supabase
        .from('montage_sheets')
        .select('id')
        .eq('video_id', videoId)
        .maybeSingle();
      
      return NextResponse.json({
        success: true,
        videoId,
        sheetId: existingSheet?.id,
        chunks: existingVideo?.chunk_progress_json?.chunks || [],
        totalChunks: existingVideo?.chunk_progress_json?.totalChunks || 0,
        message: 'Initialization already in progress (duplicate request blocked)',
      });
    }

    console.log(`🔒 Acquired initialization lock for video ${videoId}`);
    const video = lockResult[0];

    // Create chunks based on video duration
    const chunks = createVideoChunks(videoDuration);
    console.log(`📦 Created ${chunks.length} chunks`);

    // Check if montage sheet already exists (prevent duplicates)
    const { data: existingSheet } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .maybeSingle();

    let sheet;
    if (existingSheet) {
      console.log(`✅ Using existing montage sheet for video ${videoId}`);
      sheet = existingSheet;
    } else {
      // Create montage sheet
      const { data: newSheet, error: sheetError } = await supabase
        .from('montage_sheets')
        .insert({
          video_id: videoId,
          user_id: video.user_id,
          title: `Монтажный лист (${chunks.length} частей)`,
        })
        .select()
        .single();

      if (sheetError || !newSheet) {
        console.error('Error creating sheet:', sheetError);
        throw new Error('Failed to create montage sheet');
      }
      sheet = newSheet;
      console.log(`✅ Created new montage sheet for video ${videoId}`);
    }

    // Initialize chunk progress with script data
    const chunkProgress = {
      totalChunks: chunks.length,
      completedChunks: 0,
      currentChunk: 0,
      sheetId: sheet.id,
      // Сохраняем данные сценария для использования в process-chunk
      scriptData: scriptData || null,
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
    
    // ═══════════════════════════════════════════════════════════════
    // ГИБРИДНЫЙ РЕЖИМ: FFmpeg таймкоды + AI содержание
    // ═══════════════════════════════════════════════════════════════
    // FFmpeg определяет ТОЧНЫЕ таймкоды монтажных склеек
    // AI описывает СОДЕРЖАНИЕ каждого плана
    // ═══════════════════════════════════════════════════════════════
    
    console.log(`\n🎬 ГИБРИДНЫЙ РЕЖИМ: FFmpeg + AI`);
    console.log(`   📐 FFmpeg: точные таймкоды склеек`);
    console.log(`   🤖 AI: описания, диалоги, типы планов`);
    
    // Detect video FPS for accurate timecodes
    let videoFPS = 24;
    try {
      videoFPS = await detectVideoFPS(originalVideoPath);
    } catch (e) {
      console.warn(`⚠️ Could not detect FPS, using default ${videoFPS}`);
    }
    
    // Run FFmpeg scene detection
    let detectedScenes: Array<{ timecode: string; timestamp: number }> = [];
    try {
      const isFFmpegAvailable = await validateFFmpeg();
      
      if (isFFmpegAvailable) {
        console.log(`\n🔍 Running FFmpeg scene detection...`);
        const rawScenes = await detectScenes(originalVideoPath, { 
          threshold: 0.3, // Standard threshold for scene changes
          fps: videoFPS,
          maxScenes: 5000, // Safety limit
        });
        
        detectedScenes = rawScenes.map(s => ({
          timecode: s.timecode,
          timestamp: s.timestamp,
        }));
        
        // ВАЖНО: Добавляем начальную сцену (00:00:00:00) если её нет
        // FFmpeg находит ИЗМЕНЕНИЯ, но не первую сцену
        if (detectedScenes.length === 0 || detectedScenes[0].timestamp > 0.5) {
          detectedScenes.unshift({
            timecode: '00:00:00:00',
            timestamp: 0,
          });
          console.log(`📍 Added opening scene at 00:00:00:00`);
        }
        
        // Добавляем финальную сцену в конце видео
        const lastSceneTime = detectedScenes[detectedScenes.length - 1]?.timestamp || 0;
        if (videoDuration - lastSceneTime > 2.0) {
          // Если до конца видео больше 2 секунд, добавляем конечную точку
          const totalFrames = Math.round(videoDuration * videoFPS);
          const frames = ((totalFrames % videoFPS) + videoFPS) % videoFPS;
          const totalSeconds = Math.floor(totalFrames / videoFPS);
          const secs = totalSeconds % 60;
          const totalMinutes = Math.floor(totalSeconds / 60);
          const mins = totalMinutes % 60;
          const hours = Math.floor(totalMinutes / 60);
          const finalTimecode = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
          detectedScenes.push({
            timecode: finalTimecode,
            timestamp: videoDuration,
          });
          console.log(`📍 Added closing scene at ${finalTimecode}`);
        }
        
        console.log(`✅ FFmpeg detected ${detectedScenes.length} scene changes (including start/end)`);
        
        if (detectedScenes.length > 0) {
          const scenesPerMinute = (detectedScenes.length / (videoDuration / 60)).toFixed(1);
          console.log(`   📊 Average: ${scenesPerMinute} scenes/minute`);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // ОБЪЕДИНЕНИЕ ЗАСТАВКИ И ФИНАЛЬНЫХ ТИТРОВ
        // Реальный монтажный лист: заставка = ОДИН план, титры = ОДИН план
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n🎬 Detecting opening credits and closing titles...`);
        const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS);
        
        // Сохраняем merged scenes вместо raw scenes
        (chunkProgress as any).mergedScenes = mergedScenes;
        console.log(`📊 Merged: ${detectedScenes.length} raw scenes → ${mergedScenes.length} plans`);
        
      } else {
        console.warn(`⚠️ FFmpeg not available, AI will determine scenes`);
      }
    } catch (e) {
      console.error(`❌ FFmpeg scene detection failed:`, e);
      console.log(`   Falling back to AI-only mode`);
    }
    
    // Store detected scenes in chunk progress
    (chunkProgress as any).detectedScenes = detectedScenes;
    (chunkProgress as any).videoFPS = videoFPS;
    
    console.log(`\n🎤 Диалоги извлекаются напрямую по аудио`);
    
    // Whisper disabled - AI handles audio
    (chunkProgress as any).useWhisper = false;
    (chunkProgress as any).whisperSegments = null;
    
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
      
      // Use stream for uploading large files to avoid memory issues
      const fileStream = fs.createReadStream(chunkFile.localPath);
      
      // Get file size for stats
      const stats = fs.statSync(chunkFile.localPath);
      const fileSizeInBytes = stats.size;
      console.log(`📦 Uploading chunk ${chunkFile.chunkIndex} size: ${(fileSizeInBytes / (1024 * 1024)).toFixed(2)} MB`);

      const uploadChunkWithRetry = async () => {
        const MAX_ATTEMPTS = 5; // Increased from 3
        const INITIAL_RETRY_DELAY_MS = 2000;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            // Need to recreate stream for each attempt because a stream can only be read once
            const currentStream = fs.createReadStream(chunkFile.localPath);
            
            const { error: uploadError } = await supabase.storage
              .from('videos')
              .upload(chunkStoragePath, currentStream, {
                contentType: 'video/mp4',
                upsert: true, // Allow overwriting on retry (file may already exist from partial upload)
                duplex: 'half', // Important for Node.js streams!
              });

            if (!uploadError) {
              console.log(`✅ Chunk ${chunkFile.chunkIndex} uploaded successfully on attempt ${attempt}`);
              return;
            }

            // If file already exists and upsert somehow failed, treat as success
            // (this can happen if a previous request uploaded the file)
            if (uploadError.message?.includes('already exists') || 
                (uploadError as { statusCode?: string }).statusCode === '409') {
              console.log(`✅ Chunk ${chunkFile.chunkIndex} already exists, treating as success`);
              return;
            }

            // If we got an error from Supabase
            console.error(
              `Error uploading chunk ${chunkFile.chunkIndex} (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              uploadError
            );
            
            if (attempt === MAX_ATTEMPTS) {
              throw new Error(`Failed to upload chunk ${chunkFile.chunkIndex}: ${uploadError.message}`);
            }
          } catch (err) {
            // Network errors or other exceptions
            console.error(
              `Exception uploading chunk ${chunkFile.chunkIndex} (attempt ${attempt}/${MAX_ATTEMPTS}):`,
              err
            );
            
            if (attempt === MAX_ATTEMPTS) {
              throw err;
            }
          }

          // Exponential backoff: 2s, 4s, 8s, 16s, 32s
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise(res => setTimeout(res, delay));
        }
      };

      await uploadChunkWithRetry();

      // Try public URL first (better for external APIs), fallback to signed URL
      let storageUrl: string = '';
      
      // First, try public URL
      const { data: publicUrlData } = supabase.storage
        .from('videos')
        .getPublicUrl(chunkStoragePath);
      
      // Test if public URL is accessible
      let usePublicUrl = false;
      try {
        const testResponse = await fetch(publicUrlData.publicUrl, { method: 'HEAD' });
        if (testResponse.ok) {
          usePublicUrl = true;
          storageUrl = publicUrlData.publicUrl;
          console.log(`✅ Using public URL for chunk ${chunkFile.chunkIndex} (accessible for external APIs)`);
        }
      } catch {
        // Public URL not accessible
      }
      
      // Fallback to signed URL if public URL doesn't work
      if (!usePublicUrl) {
        const { data: signedUrlData, error: urlError } = await supabase.storage
          .from('videos')
          .createSignedUrl(chunkStoragePath, 60 * 60 * 24 * 7); // 7 days

        if (urlError || !signedUrlData) {
          console.error(`Error creating signed URL for chunk ${chunkFile.chunkIndex}:`, urlError);
          throw new Error(`Failed to create signed URL for chunk ${chunkFile.chunkIndex}`);
        }
        
        storageUrl = signedUrlData.signedUrl;
        console.log(`✅ Using signed URL for chunk ${chunkFile.chunkIndex} (public URL not accessible)`);
      }


      // Update chunk progress with storage URL
      chunkProgress.chunks[chunkFile.chunkIndex].storageUrl = storageUrl;
      
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

    // Trigger background processing for all chunks (fire and forget)
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}`;
    
    console.log(`🚀 Triggering background processing for all chunks of video ${videoId}`);
    
    fetch(`${baseUrl}/api/process-all-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(err => {
      console.error(`❌ Failed to trigger chunk processing for video ${videoId}:`, err);
    });

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

