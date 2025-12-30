/**
 * Init Processing V3 — упрощённая инициализация
 * 
 * Отличия от v2:
 * - Маркер processingVersion: 'v3' для различения
 * - Использует prompts-v3
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createVideoChunks } from '@/lib/video-chunking';
import { downloadVideo, splitVideoIntoChunks, cleanupTempFiles } from '@/lib/video-splitter';
import { detectScenes, validateFFmpeg, detectVideoFPS } from '@/lib/scene-detection';
import { mergeCreditsScenes, type MergedScene } from '@/lib/credits-detector';
import path from 'path';
import fs from 'fs';

// 5 minutes timeout
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

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 V3 INIT: Инициализация видео ${videoId} (${videoDuration}s)`);
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
        chunk_progress_json: { initializing: true, timestamp: new Date().toISOString(), processingVersion: 'v3' }
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
          title: `Монтажный лист v3 (${chunks.length} частей)`,
        })
        .select()
        .single();

      if (sheetError || !newSheet) {
        throw new Error('Failed to create montage sheet');
      }
      sheet = newSheet;
      console.log(`✅ Created new sheet (v3)`);
    }

    // Initialize chunk progress with V3 marker
    const chunkProgress: any = {
      totalChunks: chunks.length,
      completedChunks: 0,
      currentChunk: 0,
      sheetId: sheet.id,
      processingVersion: 'v3', // <-- МАРКЕР V3
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
    const tempDir = '/tmp/video-chunks-v3';
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
    
    // Run FFmpeg scene detection
    let detectedScenes: Array<{ timecode: string; timestamp: number }> = [];
    try {
      const isFFmpegAvailable = await validateFFmpeg();
      
      if (isFFmpegAvailable) {
        console.log(`\n🔍 FFmpeg scene detection...`);
        const rawScenes = await detectScenes(originalVideoPath, { 
          threshold: 0.3,
          fps: videoFPS,
          maxScenes: 5000,
        });
        
        detectedScenes = rawScenes.map(s => ({
          timecode: s.timecode,
          timestamp: s.timestamp,
        }));
        
        // Add opening scene if missing
        if (detectedScenes.length === 0 || detectedScenes[0].timestamp > 0.5) {
          detectedScenes.unshift({ timecode: '00:00:00:00', timestamp: 0 });
          console.log(`📍 Added opening at 00:00:00:00`);
        }
        
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
        
        console.log(`✅ FFmpeg: ${detectedScenes.length} scene changes`);
        
        // Merge credits
        console.log(`\n🎬 Merging opening/closing credits...`);
        const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS);
        chunkProgress.mergedScenes = mergedScenes;
        console.log(`📊 ${detectedScenes.length} raw → ${mergedScenes.length} merged`);
        
      } else {
        console.warn(`⚠️ FFmpeg not available`);
      }
    } catch (e) {
      console.error(`❌ FFmpeg failed:`, e);
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
    
    // Upload chunks
    console.log(`\n☁️  Uploading ${chunkFiles.length} chunks...`);
    
    for (const chunkFile of chunkFiles) {
      const chunkStoragePath = `${video.user_id}/chunks-v3/chunk_${chunkFile.chunkIndex}_${Date.now()}.mp4`;
      
      const stats = fs.statSync(chunkFile.localPath);
      console.log(`📦 Chunk ${chunkFile.chunkIndex}: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

      // Upload with retry
      const MAX_ATTEMPTS = 5;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const currentStream = fs.createReadStream(chunkFile.localPath);
          
          const { error: uploadError } = await supabase.storage
            .from('videos')
            .upload(chunkStoragePath, currentStream, {
              contentType: 'video/mp4',
              upsert: true,
              duplex: 'half',
            });

          if (!uploadError) {
            console.log(`✅ Chunk ${chunkFile.chunkIndex} uploaded`);
            break;
          }

          if (uploadError.message?.includes('already exists')) {
            console.log(`✅ Chunk ${chunkFile.chunkIndex} exists`);
            break;
          }

          if (attempt === MAX_ATTEMPTS) {
            throw new Error(`Upload failed: ${uploadError.message}`);
          }
        } catch (err) {
          if (attempt === MAX_ATTEMPTS) throw err;
          const delay = 2000 * Math.pow(2, attempt - 1);
          console.log(`⏳ Retry in ${delay}ms...`);
          await new Promise(res => setTimeout(res, delay));
        }
      }

      // Get URL
      let storageUrl: string = '';
      const { data: publicUrlData } = supabase.storage
        .from('videos')
        .getPublicUrl(chunkStoragePath);
      
      try {
        const testResponse = await fetch(publicUrlData.publicUrl, { method: 'HEAD' });
        if (testResponse.ok) {
          storageUrl = publicUrlData.publicUrl;
        }
      } catch {}
      
      if (!storageUrl) {
        const { data: signedUrlData } = await supabase.storage
          .from('videos')
          .createSignedUrl(chunkStoragePath, 60 * 60 * 24 * 7);
        storageUrl = signedUrlData?.signedUrl || '';
      }

      chunkProgress.chunks[chunkFile.chunkIndex].storageUrl = storageUrl;
    }

    // Save progress
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    // Cleanup
    console.log('🧹 Cleaning up temp files...');
    cleanupTempFiles(tempFiles);

    console.log(`\n✅ V3 INIT COMPLETE. Ready to process ${chunks.length} chunks`);

    // Trigger background processing (V3 endpoint!)
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}`;
    
    console.log(`🚀 Triggering V3 processing for ${videoId}`);
    
    fetch(`${baseUrl}/api/process-all-chunks-v3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(err => {
      console.error(`❌ Failed to trigger V3 processing:`, err);
    });

    return NextResponse.json({
      success: true,
      videoId,
      sheetId: sheet.id,
      processingVersion: 'v3',
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
    console.error('V3 Init Error:', error);
    
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

