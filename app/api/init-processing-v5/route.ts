/**
 * Init Processing V5 — Улучшенная архитектура (BETA)
 * 
 * Ключевые отличия от V4:
 * 1. СНАЧАЛА полная аудио-диаризация (весь фильм)
 * 2. ASR↔Script alignment для точного маппинга
 * 3. Speaker→Character с no-jumps правилом
 * 4. Face presence с 3 состояниями
 * 5. Overlap dedup на уровне speech_segments
 * 
 * Gemini используется ТОЛЬКО для:
 * - Тип плана (Кр./Ср./Общ.)
 * - Описание сцены
 * - Visual tags (НЕ для "кто говорит")
 * 
 * @author AI Assistant
 * @version 5.0-beta
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
} from '@/lib/pyscenedetect';
import { mergeCreditsScenes } from '@/lib/credits-detector';
import { smartMergeScenes } from '@/lib/smart-scene-merger';
import { 
  groupWordsIntoSegments, 
  alignASRToScript,
  type ASRWord,
} from '@/lib/asr-script-alignment';
import { 
  SpeakerCharacterMapper, 
  logMappingStats,
} from '@/lib/speaker-character-mapper';
import { type ScriptLine } from '@/lib/script-parser-deterministic';
import path from 'path';
import fs from 'fs';

// Feature flags
const USE_FACE_RECOGNITION = process.env.USE_FACE_RECOGNITION === 'true';
const USE_FULL_DIARIZATION = true; // V5 всегда использует полную диаризацию

// Dynamic import types
type FaceCluster = {
  clusterId: string;
  appearances: number;
  firstSeen: number;
  lastSeen: number;
  characterName?: string | null;
  centroid?: number[];
  faces?: Array<{ timestamp: number }>;
};

// 10 minutes timeout (V5 делает больше работы)
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];
  const startTime = Date.now();
  
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

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🚀 V5 BETA INIT — Improved Architecture`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   Video: ${videoId}`);
    console.log(`   Duration: ${videoDuration}s (${(videoDuration / 60).toFixed(1)} min)`);
    console.log(`   Face Recognition: ${USE_FACE_RECOGNITION ? 'ENABLED' : 'disabled'}`);
    console.log(`   Full Diarization: ${USE_FULL_DIARIZATION ? 'ENABLED' : 'disabled'}`);
    
    // Log script data
    const hasScript = scriptData?.characters?.length > 0;
    const scriptLines: ScriptLine[] = scriptData?.lines || [];
    
    if (hasScript) {
      console.log(`\n📋 SCRIPT DATA:`);
      console.log(`   Characters: ${scriptData.characters.length}`);
      console.log(`   Lines: ${scriptLines.length}`);
      const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      if (mainChars.length > 0) {
        console.log(`   Main: ${mainChars.slice(0, 5).map((c: any) => c.name).join(', ')}`);
      }
    } else {
      console.log(`\n⚠️  No script provided — character identification will be limited`);
    }

    const supabase = createServiceRoleClient();

    // Atomic lock
    const { data: lockResult, error: lockError } = await supabase
      .from('videos')
      .update({ 
        status: 'processing',
        chunk_progress_json: { 
          initializing: true, 
          timestamp: new Date().toISOString(), 
          processingVersion: 'v5-beta',
          architecture: 'improved',
        }
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
      
      return NextResponse.json({
        success: true,
        videoId,
        message: 'Already initializing (duplicate blocked)',
        progress: existingVideo?.chunk_progress_json,
      });
    }

    console.log(`\n🔒 Lock acquired for ${videoId}`);
    const video = lockResult[0];

    // Create chunks
    const chunks = createVideoChunks(videoDuration);
    console.log(`📦 Created ${chunks.length} chunks`);

    // Create/get montage sheet
    const { data: existingSheet } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .maybeSingle();

    let sheet;
    if (existingSheet) {
      sheet = existingSheet;
    } else {
      const { data: newSheet, error: sheetError } = await supabase
        .from('montage_sheets')
        .insert({
          video_id: videoId,
          user_id: video.user_id,
          title: `Монтажный лист V5 BETA (${chunks.length} частей)`,
        })
        .select()
        .single();

      if (sheetError || !newSheet) {
        throw new Error('Failed to create montage sheet');
      }
      sheet = newSheet;
    }

    // Initialize chunk progress with V5 markers
    const chunkProgress: any = {
      totalChunks: chunks.length,
      completedChunks: 0,
      currentChunk: 0,
      sheetId: sheet.id,
      processingVersion: 'v5-beta',
      architecture: 'improved',
      sceneDetector: 'pyscenedetect',
      scriptData: scriptData || null,
      chunks: chunks.map(chunk => ({
        index: chunk.chunkIndex,
        status: 'pending' as const,
        startTimecode: chunk.startTimecode,
        endTimecode: chunk.endTimecode,
        storageUrl: null as string | null,
      })),
      // V5-specific fields
      speakerCharacterMap: {},
      speechSegments: [],
      alignmentStats: null,
    };

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Download video
    // ═══════════════════════════════════════════════════════════════════
    const tempDir = '/tmp/video-chunks-v5';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const originalVideoPath = path.join(tempDir, `original_${videoId}.mp4`);
    console.log(`\n📥 STEP 1: Downloading video...`);
    await downloadVideo(videoUrl, originalVideoPath);
    tempFiles.push(originalVideoPath);
    
    // Detect FPS
    let videoFPS = 24;
    try {
      videoFPS = await detectVideoFPS(originalVideoPath);
      console.log(`   FPS: ${videoFPS}`);
    } catch (e) {
      console.warn(`   ⚠️ Could not detect FPS, using default ${videoFPS}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Full Audio Diarization (ВЕСЬ ФИЛЬМ СРАЗУ)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎤 STEP 2: Full Audio Diarization (entire video)...`);
    
    let fullDiarizationWords: ASRWord[] = [];
    let speakerCharacterMapper = new SpeakerCharacterMapper();
    
    if (USE_FULL_DIARIZATION && process.env.ASSEMBLYAI_API_KEY) {
      try {
        const { performFullDiarization } = await import('@/lib/full-audio-diarization');
        
        const characterNames = hasScript 
          ? scriptData.characters.map((c: any) => c.name).slice(0, 20)
          : [];
        
        const diarizationResult = await performFullDiarization(
          videoUrl,
          'ru',
          characterNames,
          10
        );
        
        console.log(`   ✅ Diarization complete:`);
        console.log(`      Words: ${diarizationResult.words.length}`);
        console.log(`      Speakers: ${diarizationResult.speakers.join(', ')}`);
        console.log(`      Duration: ${(diarizationResult.totalDuration / 60).toFixed(1)} min`);
        
        // Convert to ASRWord format (AssemblyAI uses 'word', we use 'text')
        fullDiarizationWords = diarizationResult.words.map(w => ({
          text: w.word,  // AssemblyAI field is 'word', not 'text'
          startMs: w.start,
          endMs: w.end,
          confidence: w.confidence,
          speaker: w.speaker,
        }));
        
        // 🔒 Save diarization IMMEDIATELY (before potentially failing alignment)
        chunkProgress.fullDiarizationWords = fullDiarizationWords.slice(0, 50000);
        console.log(`   💾 Saved ${fullDiarizationWords.length} words to chunk progress`);
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 3: ASR↔Script Alignment (если есть сценарий)
        // ═══════════════════════════════════════════════════════════════
        if (hasScript && scriptLines.length > 0) {
          console.log(`\n📝 STEP 3: ASR↔Script Alignment...`);
          
          const asrSegments = groupWordsIntoSegments(fullDiarizationWords);
          console.log(`   ASR segments: ${asrSegments.length}`);
          
          const alignmentResult = alignASRToScript(asrSegments, scriptLines);
          
          console.log(`   ✅ Alignment complete:`);
          console.log(`      Matched: ${alignmentResult.totalMatched}`);
          console.log(`      Unmatched: ${alignmentResult.totalUnmatched}`);
          console.log(`      Anchors: ${alignmentResult.anchorCount}`);
          
          // Build speaker→character mapping
          speakerCharacterMapper.addAlignmentEvidence(alignmentResult);
          
          chunkProgress.alignmentStats = {
            totalMatched: alignmentResult.totalMatched,
            totalUnmatched: alignmentResult.totalUnmatched,
            anchorCount: alignmentResult.anchorCount,
          };
        }
        
        // Build final mapping
        const mappingResult = speakerCharacterMapper.buildMapping();
        logMappingStats(mappingResult);
        
        // Store mapping for chunk processing
        chunkProgress.speakerCharacterMap = speakerCharacterMapper.export();
        
      } catch (diarError) {
        console.error(`   ❌ Diarization failed:`, diarError);
        console.log(`   Continuing without full diarization...`);
      }
    } else {
      console.log(`   ⚠️ Full diarization skipped (no ASSEMBLYAI_API_KEY)`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Face Recognition (optional)
    // ═══════════════════════════════════════════════════════════════════
    let faceClusters: FaceCluster[] = [];
    
    if (USE_FACE_RECOGNITION) {
      console.log(`\n🎭 STEP 4: Face Recognition...`);
      
      try {
        const { clusterFacesInVideoWorker } = await import('@/lib/face-clustering');
        
        faceClusters = await clusterFacesInVideoWorker(originalVideoPath, {
          frameInterval: 5,
          distanceThreshold: 0.5,
          minAppearances: 5,
        });
        
        console.log(`   ✅ Found ${faceClusters.length} unique faces`);
        
        // Auto-bind faces to characters based on frequency
        if (hasScript && faceClusters.length > 0) {
          const sortedClusters = [...faceClusters].sort((a, b) => b.appearances - a.appearances);
          const mainCharacters = scriptData.characters
            .filter((c: { dialogueCount?: number }) => (c.dialogueCount || 0) >= 10)
            .sort((a: { dialogueCount?: number }, b: { dialogueCount?: number }) =>
              (b.dialogueCount || 0) - (a.dialogueCount || 0)
            );
          
          const boundCount = Math.min(sortedClusters.length, mainCharacters.length, 5);
          for (let i = 0; i < boundCount; i++) {
            sortedClusters[i].characterName = mainCharacters[i].name?.toUpperCase();
          }
          
          console.log(`   🔗 Auto-bound ${boundCount} faces to main characters`);
        }
        
      } catch (faceError) {
        console.error(`   ❌ Face recognition failed:`, faceError);
      }
    } else {
      console.log(`\nℹ️  Face Recognition disabled`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: PySceneDetect
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎬 STEP 5: Scene Detection (PySceneDetect)...`);
    
    let detectedScenes: Array<{ timecode: string; timestamp: number }> = [];
    
    try {
      const isPySceneDetectAvailable = await validatePySceneDetect();
      
      if (isPySceneDetectAvailable) {
        const rawScenes = await detectScenesWithPySceneDetect(originalVideoPath, { 
          fps: videoFPS,
          adaptiveThreshold: 1.8,
          minSceneDuration: 0.25,
          maxScenes: 5000,
        });
        
        const smartMerged = smartMergeScenes(rawScenes, {
          ultraShortThreshold: 0.3,
          shortThreshold: 0.8,
        });
        
        detectedScenes = smartMerged.map(s => ({
          timecode: s.timecode,
          timestamp: s.timestamp,
        }));
        
        console.log(`   ✅ Detected ${detectedScenes.length} scene changes`);
        
        // Add closing scene
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
        }
        
        // Merge credits
        const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS, {
          skipCreditsMerging: false,
        });
        chunkProgress.mergedScenes = mergedScenes;
        console.log(`   📊 After credits merge: ${mergedScenes.length} plans`);
        
      } else {
        console.warn(`   ⚠️ PySceneDetect not available`);
      }
    } catch (e) {
      console.error(`   ❌ Scene detection failed:`, e);
    }
    
    chunkProgress.detectedScenes = detectedScenes;
    chunkProgress.videoFPS = videoFPS;
    
    // Save face clusters
    if (faceClusters.length > 0) {
      chunkProgress.faceClusters = faceClusters.map(cluster => ({
        clusterId: cluster.clusterId,
        appearances: cluster.appearances,
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
        characterName: cluster.characterName || null,
        centroid: cluster.centroid ? Array.from(cluster.centroid) : [],
        faceTimestamps: cluster.faces?.map(f => f.timestamp) || [],
      }));
      chunkProgress.useFaceRecognition = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Split & Upload Chunks
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n✂️  STEP 6: Splitting into ${chunks.length} chunks...`);
    
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
    
    const PARALLEL_UPLOADS = 2;
    const uploadChunk = async (chunkFile: { chunkIndex: number; localPath: string }) => {
      const chunkStoragePath = `${video.user_id}/chunks-v5/chunk_${chunkFile.chunkIndex}_${Date.now()}.mp4`;
      
      const stats = fs.statSync(chunkFile.localPath);
      const fileBuffer = fs.readFileSync(chunkFile.localPath);
      
      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(chunkStoragePath, fileBuffer, {
          contentType: 'video/mp4',
          cacheControl: '3600',
        });
        
      if (uploadError) {
        throw new Error(`Upload failed for chunk ${chunkFile.chunkIndex}: ${uploadError.message}`);
      }
      
      const { data: { publicUrl } } = supabase.storage
        .from('videos')
        .getPublicUrl(chunkStoragePath);
      
      return { chunkIndex: chunkFile.chunkIndex, url: publicUrl };
    };
    
    // Upload in batches
    const uploadedChunks: Array<{ chunkIndex: number; url: string }> = [];
    for (let i = 0; i < chunkFiles.length; i += PARALLEL_UPLOADS) {
      const batch = chunkFiles.slice(i, i + PARALLEL_UPLOADS);
      const results = await Promise.all(batch.map(uploadChunk));
      uploadedChunks.push(...results);
      console.log(`   📤 Uploaded ${Math.min(i + PARALLEL_UPLOADS, chunkFiles.length)}/${chunkFiles.length}`);
    }
    
    // Update chunk progress with URLs
    for (const uploaded of uploadedChunks) {
      chunkProgress.chunks[uploaded.chunkIndex].storageUrl = uploaded.url;
      chunkProgress.chunks[uploaded.chunkIndex].status = 'ready';
    }
    
    // Save progress
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);
    
    // Cleanup temp files
    cleanupTempFiles(tempFiles);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ V5 BETA INIT COMPLETE`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   Total time: ${totalTime}s`);
    console.log(`   Scenes: ${chunkProgress.mergedScenes?.length || detectedScenes.length}`);
    console.log(`   Faces: ${faceClusters.length}`);
    console.log(`   Speaker→Character mappings: ${Object.keys(chunkProgress.speakerCharacterMap).length}`);
    console.log(`\n🚀 Ready for chunk processing (process-chunk-v5)`);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: Trigger chunk processing
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎯 STEP 7: Triggering chunk processing...`);
    
    // Fire and forget
    fetch(`${savedBaseUrl}/api/process-all-chunks-v5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(err => console.error('Failed to trigger chunk processing:', err));
    
    return NextResponse.json({
      success: true,
      videoId,
      sheetId: sheet.id,
      totalChunks: chunks.length,
      totalScenes: chunkProgress.mergedScenes?.length || detectedScenes.length,
      architecture: 'improved',
      processingVersion: 'v5-beta',
      speakerMappings: Object.keys(chunkProgress.speakerCharacterMap).length,
      faceClusters: faceClusters.length,
      initTime: totalTime,
    });
    
  } catch (error) {
    console.error('❌ V5 BETA init error:', error);
    
    cleanupTempFiles(tempFiles);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Init processing failed' },
      { status: 500 }
    );
  }
}
