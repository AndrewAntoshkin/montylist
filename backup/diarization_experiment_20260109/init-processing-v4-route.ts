/**
 * Init Processing V4 — с PySceneDetect
 * 
 * Отличия от v3:
 * - Использует PySceneDetect вместо FFmpeg для детекции сцен
 * - AdaptiveDetector для лучшего распознавания наплывов
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks } from '@/lib/video-chunking';
import { downloadVideo, splitVideoIntoChunks, cleanupTempFiles } from '@/lib/video-splitter';
import { detectVideoFPS } from '@/lib/scene-detection';
import { 
  detectScenesWithPySceneDetect, 
  validatePySceneDetect,
  pyScenesToPlanBoundaries 
} from '@/lib/pyscenedetect';
import { mergeCreditsScenes, type MergedScene } from '@/lib/credits-detector';
import path from 'path';
import fs from 'fs';

// 5 minutes timeout
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];
  
  // Save baseUrl early - ALWAYS use request.url for correct port
  const requestUrl = new URL(request.url);
  const savedBaseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  
  try {
    const { videoId, videoUrl, videoDuration, filmMetadata, scriptData } = await request.json();

    if (!videoId || !videoUrl || !videoDuration) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, videoUrl, videoDuration' },
        { status: 400 }
      );
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 V4 INIT (PySceneDetect): Видео ${videoId} (${videoDuration}s)`);
    console.log(`${'═'.repeat(60)}`);
    
    // Log script data if present
    if (scriptData?.characters?.length > 0) {
      console.log(`📋 СЦЕНАРИЙ: ${scriptData.characters.length} персонажей`);
      const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      if (mainChars.length > 0) {
        console.log(`   🌟 Главные: ${mainChars.map((c: any) => c.name).join(', ')}`);
      }
    }

    const supabase = createServiceRoleClient();

    // Atomic check-and-set to prevent duplicate initialization
    const { data: lockResult, error: lockError } = await supabase
      .from('videos')
      .update({ 
        status: 'processing',
        chunk_progress_json: { initializing: true, timestamp: new Date().toISOString(), processingVersion: 'v4' }
      })
      .eq('id', videoId)
      .eq('status', 'processing')
      .is('chunk_progress_json', null)
      .select('user_id');

    if (!lockResult || lockResult.length === 0) {
      console.log(`⚠️  Video ${videoId} is already being initialized`);
      
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
        message: 'Already initializing (duplicate blocked)',
      });
    }

    console.log(`🔒 Lock acquired for ${videoId}`);
    const video = lockResult[0];

    // Create chunks
    const chunks = createVideoChunks(videoDuration);
    console.log(`📦 Created ${chunks.length} chunks`);

    // Check/create montage sheet
    const { data: existingSheet } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .maybeSingle();

    let sheet;
    if (existingSheet) {
      console.log(`✅ Using existing sheet`);
      sheet = existingSheet;
    } else {
      const { data: newSheet, error: sheetError } = await supabase
        .from('montage_sheets')
        .insert({
          video_id: videoId,
          user_id: video.user_id,
          title: `Монтажный лист v4 PySceneDetect (${chunks.length} частей)`,
        })
        .select()
        .single();

      if (sheetError || !newSheet) {
        throw new Error('Failed to create montage sheet');
      }
      sheet = newSheet;
      console.log(`✅ Created new sheet (v4 PySceneDetect)`);
    }

    // Initialize chunk progress with V4 marker
    const chunkProgress: any = {
      totalChunks: chunks.length,
      completedChunks: 0,
      currentChunk: 0,
      sheetId: sheet.id,
      processingVersion: 'v4', // <-- МАРКЕР V4
      sceneDetector: 'pyscenedetect', // <-- Метод детекции
      scriptData: scriptData || null,
      chunks: chunks.map(chunk => ({
        index: chunk.chunkIndex,
        status: 'pending' as const,
        startTimecode: chunk.startTimecode,
        endTimecode: chunk.endTimecode,
        storageUrl: null as string | null,
      })),
    };

    // Download video
    const tempDir = '/tmp/video-chunks-v4';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const originalVideoPath = path.join(tempDir, `original_${videoId}.mp4`);
    console.log(`📥 Downloading video...`);
    await downloadVideo(videoUrl, originalVideoPath);
    tempFiles.push(originalVideoPath);
    
    // Detect FPS
    let videoFPS = 24;
    try {
      videoFPS = await detectVideoFPS(originalVideoPath);
    } catch (e) {
      console.warn(`⚠️ Could not detect FPS, using default ${videoFPS}`);
    }
    
    // Run PySceneDetect scene detection
    let detectedScenes: Array<{ timecode: string; timestamp: number }> = [];
    
    try {
      const isPySceneDetectAvailable = await validatePySceneDetect();
      
      if (isPySceneDetectAvailable) {
        console.log(`\n🔍 PySceneDetect scene detection (AdaptiveDetector)...`);
        
        const rawScenes = await detectScenesWithPySceneDetect(originalVideoPath, { 
          fps: videoFPS,
          adaptiveThreshold: 2.0,  // Чувствительнее к мягким cuts (было 2.5)
          minSceneDuration: 0.2,   // Ловит короткие планы 0.2 сек (было 0.4)
          maxScenes: 5000,
        });
        
        detectedScenes = rawScenes.map(s => ({
          timecode: s.timecode,
          timestamp: s.timestamp,
        }));
        
        console.log(`✅ PySceneDetect: ${detectedScenes.length} scene changes`);
        
        // Add closing scene if needed
        const lastSceneTime = detectedScenes[detectedScenes.length - 1]?.timestamp || 0;
        if (videoDuration - lastSceneTime > 2.0) {
          const totalFrames = Math.round(videoDuration * videoFPS);
          const frames = ((totalFrames % videoFPS) + videoFPS) % videoFPS;
          const totalSeconds = Math.floor(totalFrames / videoFPS);
          const secs = totalSeconds % 60;
          const totalMinutes = Math.floor(totalSeconds / 60);
          const mins = totalMinutes % 60;
          const hours = Math.floor(totalMinutes / 60);
          const finalTimecode = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
          detectedScenes.push({ timecode: finalTimecode, timestamp: videoDuration });
          console.log(`📍 Added closing at ${finalTimecode}`);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // ОБЪЕДИНЯЕМ заставку ДО отправки в Gemini
        // 
        // Реальный монтажный лист:
        // - План 1: Логотип (00:00:00:00 - 00:00:04:09) = ~4 сек
        // - План 2: Заставка (00:00:04:09 - 00:01:06:13) = ~62 сек = ОДИН план!
        // 
        // Без объединения: PySceneDetect нарезает заставку на 20-30 мелких планов,
        // что не соответствует эталону.
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n🎬 Merging credits scenes (logo + opening credits)...`);
        const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS, {
          skipCreditsMerging: false, // ВКЛЮЧЕНО: объединяем заставку в один план
        });
        chunkProgress.mergedScenes = mergedScenes;
        console.log(`📊 Credits merged: ${detectedScenes.length} raw → ${mergedScenes.length} plans`);
        
      } else {
        console.warn(`⚠️ PySceneDetect not available, falling back to FFmpeg`);
        
        // Fallback to FFmpeg
        const { detectScenes, validateFFmpeg } = await import('@/lib/scene-detection');
        const isFFmpegAvailable = await validateFFmpeg();
        
        if (isFFmpegAvailable) {
          const rawScenes = await detectScenes(originalVideoPath, { 
            threshold: 0.05,
            fps: videoFPS,
          });
          
          detectedScenes = rawScenes.map(s => ({
            timecode: s.timecode,
            timestamp: s.timestamp,
          }));
          
          if (detectedScenes.length === 0 || detectedScenes[0].timestamp > 0.5) {
            detectedScenes.unshift({ timecode: '00:00:00:00', timestamp: 0 });
          }
          
          const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS);
          chunkProgress.mergedScenes = mergedScenes;
          chunkProgress.sceneDetector = 'ffmpeg-fallback';
        }
      }
    } catch (e) {
      console.error(`❌ Scene detection failed:`, e);
    }
    
    chunkProgress.detectedScenes = detectedScenes;
    chunkProgress.videoFPS = videoFPS;
    
    // Split video into chunks
    console.log(`\n✂️  Splitting into ${chunks.length} chunks...`);
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
    
    // Upload chunks in parallel (2 at a time - Supabase rate limit friendly)
    console.log(`\n☁️  Uploading ${chunkFiles.length} chunks (parallel x2)...`);
    
    const PARALLEL_UPLOADS = 2;
    const uploadChunk = async (chunkFile: { chunkIndex: number; localPath: string }) => {
      const chunkStoragePath = `${video.user_id}/chunks-v4/chunk_${chunkFile.chunkIndex}_${Date.now()}.mp4`;
      
      const stats = fs.statSync(chunkFile.localPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`📦 Chunk ${chunkFile.chunkIndex}: ${sizeMB} MB`);

      // Upload with retry
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const fileBuffer = fs.readFileSync(chunkFile.localPath);
          
          const { error: uploadError } = await supabase.storage
            .from('videos')
            .upload(chunkStoragePath, fileBuffer, {
              contentType: 'video/mp4',
              upsert: true,
            });

          if (!uploadError) {
            console.log(`✅ Chunk ${chunkFile.chunkIndex} uploaded (${sizeMB} MB)`);
            break;
          }

          if (uploadError.message?.includes('already exists')) {
            console.log(`✅ Chunk ${chunkFile.chunkIndex} exists`);
            break;
          }

          console.log(`⚠️ Chunk ${chunkFile.chunkIndex} attempt ${attempt} failed: ${uploadError.message}`);
          if (attempt === MAX_ATTEMPTS) {
            throw new Error(`Upload failed: ${uploadError.message}`);
          }
        } catch (err) {
          console.log(`❌ Chunk ${chunkFile.chunkIndex} error attempt ${attempt}: ${err}`);
          if (attempt === MAX_ATTEMPTS) throw err;
          await new Promise(res => setTimeout(res, 2000 * attempt));
        }
      }

      // Get signed URL directly (faster than checking public URL)
      const { data: signedUrlData } = await supabase.storage
        .from('videos')
        .createSignedUrl(chunkStoragePath, 60 * 60 * 24 * 7);
      
      chunkProgress.chunks[chunkFile.chunkIndex].storageUrl = signedUrlData?.signedUrl || '';
    };

    // Process in batches of PARALLEL_UPLOADS
    for (let i = 0; i < chunkFiles.length; i += PARALLEL_UPLOADS) {
      const batch = chunkFiles.slice(i, i + PARALLEL_UPLOADS);
      console.log(`📤 Batch ${Math.floor(i/PARALLEL_UPLOADS) + 1}/${Math.ceil(chunkFiles.length/PARALLEL_UPLOADS)}: chunks ${batch.map(c => c.chunkIndex).join(', ')}`);
      await Promise.all(batch.map(uploadChunk));
    }

    // Save progress
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    // Cleanup
    console.log('🧹 Cleaning up temp files...');
    cleanupTempFiles(tempFiles);

    console.log(`\n✅ V4 INIT COMPLETE. Ready to process ${chunks.length} chunks with PySceneDetect data`);

    // Trigger background processing (V4 endpoint!)
    console.log(`🚀 Triggering V4 processing for ${videoId} via ${savedBaseUrl}`);
    
    fetch(`${savedBaseUrl}/api/process-all-chunks-v4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(err => {
      console.error(`❌ Failed to trigger V4 processing:`, err);
    });

    return NextResponse.json({
      success: true,
      videoId,
      sheetId: sheet.id,
      processingVersion: 'v4',
      sceneDetector: chunkProgress.sceneDetector,
      totalScenes: detectedScenes.length,
      chunks: chunkProgress.chunks.map((c: any) => ({
        index: c.index,
        startTimecode: c.startTimecode,
        endTimecode: c.endTimecode,
        storageUrl: c.storageUrl,
        status: c.status,
      })),
      totalChunks: chunks.length,
    });

  } catch (error) {
    console.error('V4 Init Error:', error);
    
    if (tempFiles.length > 0) {
      try {
        cleanupTempFiles(tempFiles);
      } catch {}
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


