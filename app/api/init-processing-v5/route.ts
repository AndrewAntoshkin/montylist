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
  centroid?: Float32Array | number[];
  faces?: Array<{ timestamp: number }>;
  faceTimestamps?: number[];  // Timestamps лиц (сек) - используется когда faces пустой
};

// 10 minutes timeout (V5 делает больше работы)
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];
  const startTime = Date.now();
  
  // Use internal URL for Railway (HTTP inside container)
  // Railway exposes the app on PORT internally, but uses HTTPS externally
  const requestUrl = new URL(request.url);
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
  const savedBaseUrl = isRailway 
    ? `http://localhost:${process.env.PORT || 3000}`
    : `${requestUrl.protocol}//${requestUrl.host}`;
  
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
          ? scriptData.characters.map((c: any) => c.name).slice(0, 15)
          : [];
        
        // Добавляем специфичные слова для лучшего распознавания
        // Это помогает ASR правильно транскрибировать редкие слова
        // УНИВЕРСАЛЬНЫЙ список: только часто используемые слова, специфичные для русского языка
        // Персонажи уже включены в characterNames, добавляем только универсальные слова
        const UNIVERSAL_BOOST_WORDS = [
          // Универсальные вежливые обращения и слова, часто используемые в фильмах
          'минуточку', 'пардон', 'присаживайтесь', 'проходите',
        ];
        
        // Используем имена персонажей из сценария + универсальные слова
        // НЕ добавляем специфичные слова конкретного фильма!
        const allBoostWords = [...characterNames, ...UNIVERSAL_BOOST_WORDS].slice(0, 20);
        console.log(`   📝 Word boost: ${allBoostWords.join(', ')}`);
        
        const diarizationResult = await performFullDiarization(
          videoUrl,
          'ru',
          allBoostWords,  // Используем расширенный список
          15  // УВЕЛИЧЕНО с 10 до 15 для лучшего различения всех голосов
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
          
          // Передаём сцены для scene context evidence
          const scriptScenes = scriptData?.scenes || [];
          const alignmentResult = alignASRToScript(asrSegments, scriptLines, scriptScenes);
          
          console.log(`   ✅ Alignment complete:`);
          console.log(`      Matched: ${alignmentResult.totalMatched}`);
          console.log(`      Unmatched: ${alignmentResult.totalUnmatched}`);
          console.log(`      Anchors: ${alignmentResult.anchorCount}`);
          
          // Логируем scene context информацию
          const linksWithSceneContext = alignmentResult.links.filter(l => l.sceneCharacters && l.sceneCharacters.length > 0);
          if (linksWithSceneContext.length > 0) {
            console.log(`      Scene context: ${linksWithSceneContext.length} links have character lists`);
          }
          
          // Build speaker→character mapping
          speakerCharacterMapper.addAlignmentEvidence(alignmentResult);
          
          chunkProgress.alignmentStats = {
            totalMatched: alignmentResult.totalMatched,
            totalUnmatched: alignmentResult.totalUnmatched,
            anchorCount: alignmentResult.anchorCount,
          };
        }
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 3.2: Name Mention Calibration (определение по упоминаниям имён)
        // ═══════════════════════════════════════════════════════════════
        if (hasScript && fullDiarizationWords.length > 0 && scriptData.characters.length > 0) {
          console.log(`\n📛 STEP 3.2: Name Mention Calibration...`);
          
          try {
            const { calibrateSpeakersByNameMentions } = await import('@/lib/face-speaker-binding');
            
            // Конвертируем слова в формат для calibration
            const diarizationWordsForCalibration = fullDiarizationWords
              .filter(w => w.speaker) // Убираем слова без speaker
              .map(w => ({
                text: w.text,
                start: w.startMs,
                end: w.endMs,
                speaker: w.speaker!,
              }));
            
            // Калибруем по упоминаниям имён (включая роли типа "Менеджер")
            const nameMentionMapping = calibrateSpeakersByNameMentions(
              diarizationWordsForCalibration,
              scriptData.characters.map((c: any) => ({
                name: c.name,
                variants: c.variants || [],
              }))
            );
            
            // Добавляем доказательства в mapper
            for (const [speakerId, characterName] of nameMentionMapping) {
              speakerCharacterMapper.addNameMention(speakerId, characterName, 0);
            }
            
            console.log(`   ✅ Name mention calibration: ${nameMentionMapping.size} speakers mapped`);
          } catch (nameMentionError) {
            console.error(`   ⚠️ Name mention calibration failed:`, nameMentionError);
            console.log(`   Continuing without name mention calibration...`);
          }
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
    // STEP 3.5: Voice Embeddings (для уточнения speaker→character)
    // ═══════════════════════════════════════════════════════════════════
    const USE_VOICE_EMBEDDINGS = process.env.USE_VOICE_EMBEDDINGS === 'true';
    
    if (USE_VOICE_EMBEDDINGS && fullDiarizationWords.length > 0) {
      console.log(`\n🎤 STEP 3.5: Voice Embeddings...`);
      
      try {
        const { createVoiceEmbeddings, refineSpeakerMapping } = await import('@/lib/voice-embeddings');
        
        const voiceResult = await createVoiceEmbeddings(
          originalVideoPath,
          fullDiarizationWords as any[]
        );
        
        if (voiceResult.embeddings && Object.keys(voiceResult.embeddings).length > 0) {
          console.log(`   ✅ Created voice embeddings for ${voiceResult.speaker_count} speakers`);
          
          // Сохраняем embeddings для будущего использования
          chunkProgress.voiceEmbeddings = voiceResult.embeddings;
          
          // Если есть matches — уточняем маппинг
          if (voiceResult.matches) {
            const currentMapping = speakerCharacterMapper.getMapping();
            const refinedMapping = refineSpeakerMapping(
              Object.fromEntries(currentMapping),
              voiceResult.matches,
              0.8  // confidence threshold
            );
            
            // Применяем уточнённый маппинг
            for (const [speakerId, characterName] of Object.entries(refinedMapping)) {
              speakerCharacterMapper.setManualMapping(speakerId, characterName);
            }
          }
        }
      } catch (voiceError) {
        console.error(`   ❌ Voice embeddings failed:`, voiceError);
        console.log(`   Continuing without voice embeddings...`);
      }
    } else if (!USE_VOICE_EMBEDDINGS) {
      console.log(`\n🎤 STEP 3.5: Voice Embeddings skipped (USE_VOICE_EMBEDDINGS=false)`);
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
          // УЛУЧШЕНО: берём ВСЕХ персонажей из сценария (без фильтра по репликам)
          // Любой человек в сцене — персонаж, особенно если говорит
          const allCharacters = scriptData.characters
            .sort((a: { dialogueCount?: number }, b: { dialogueCount?: number }) =>
              (b.dialogueCount || 0) - (a.dialogueCount || 0)
            );
          
          // Привязываем столько лиц, сколько есть персонажей (без жёсткого лимита)
          const boundCount = Math.min(sortedClusters.length, allCharacters.length);
          for (let i = 0; i < boundCount; i++) {
            sortedClusters[i].characterName = allCharacters[i].name?.toUpperCase();
          }
          
          console.log(`   🔗 Auto-bound ${boundCount} faces to characters (all from script)`);
        }
        
      } catch (faceError) {
        console.error(`   ❌ Face recognition failed:`, faceError);
      }
    } else {
      console.log(`\nℹ️  Face Recognition disabled`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4.5: Face Presence Evidence (связь лиц с голосами)
    // ═══════════════════════════════════════════════════════════════════
    if (faceClusters.length > 0 && fullDiarizationWords.length > 0) {
      console.log(`\n🔗 STEP 4.5: Building Face Presence Evidence...`);
      
      try {
        // Создаём face presence evidence для каждого слова диаризации
        const facePresenceEvidence: Array<{
          speakerId: string;
          faceClusterId: string;
          characterName?: string;
          startMs: number;
          endMs: number;
          dominance: number;
        }> = [];
        
        // Группируем слова по speaker для эффективности
        const wordsBySpeaker = new Map<string, typeof fullDiarizationWords>();
        for (const word of fullDiarizationWords) {
          if (!word.speaker) continue;
          const existing = wordsBySpeaker.get(word.speaker) || [];
          existing.push(word);
          wordsBySpeaker.set(word.speaker, existing);
        }
        
        // Проверяем сколько кластеров имеют characterName
        const clustersWithName = faceClusters.filter(c => c.characterName);
        console.log(`   📊 Face clusters with characterName: ${clustersWithName.length}/${faceClusters.length}`);
        if (clustersWithName.length > 0) {
          console.log(`   📋 Bound characters: ${clustersWithName.map(c => c.characterName).join(', ')}`);
          
          // Диагностика: проверяем структуру faces
          const clustersWithTimestamps = clustersWithName.filter(c => {
            const hasFaces = c.faces && c.faces.length > 0;
            const hasTimestamps = c.faceTimestamps && c.faceTimestamps.length > 0;
            return hasFaces || hasTimestamps;
          });
          console.log(`   🔍 Clusters with timestamps: ${clustersWithTimestamps.length}/${clustersWithName.length}`);
          if (clustersWithTimestamps.length > 0) {
            const sampleCluster = clustersWithTimestamps[0];
            const timestamps = sampleCluster.faces && sampleCluster.faces.length > 0
              ? sampleCluster.faces.map(f => f.timestamp)
              : (sampleCluster.faceTimestamps || []);
            const count = sampleCluster.faces?.length || sampleCluster.faceTimestamps?.length || 0;
            console.log(`   📋 Sample cluster: ${sampleCluster.clusterId} (${sampleCluster.characterName}), ${count} timestamps, first: ${timestamps[0]?.toFixed(1) || 'N/A'}s`);
          }
        }
        
        // Для каждого speaker находим какие лица были видны во время его речи
        let processedSpeakers = 0;
        for (const [speakerId, words] of wordsBySpeaker) {
          // Диагностика: логируем первые 3 speakers
          if (processedSpeakers < 3) {
            const sampleWord = words[0];
            if (sampleWord) {
              console.log(`   🔍 Processing Speaker ${speakerId}: ${words.length} words, first word at ${sampleWord.startMs / 1000}s`);
            }
          }
          processedSpeakers++;
          
          // Считаем сколько раз каждое лицо было видно во время речи этого speaker
          const facePresenceCounts = new Map<string, number>();
          
          for (const word of words) {
            const wordStartSec = word.startMs / 1000;
            const wordEndSec = word.endMs / 1000;
            
            for (const cluster of faceClusters) {
              if (!cluster.characterName) continue;
              
              // Используем faceTimestamps если faces пустой (worker mode)
              const timestamps = cluster.faces && cluster.faces.length > 0
                ? cluster.faces.map(f => f.timestamp)
                : (cluster.faceTimestamps || []);
              
              if (timestamps.length === 0) continue;
              
              // Улучшенная временная синхронизация (на основе исследований):
              // - Forward window: 3.5s (речь может начаться после появления лица)
              // - Backward window: 1.5s (лицо может появиться чуть раньше речи)
              const FORWARD_WINDOW_FACE = 3.5;  // Увеличено с 2s
              const BACKWARD_WINDOW_FACE = 1.5; // Увеличено с 2s
              
              const facesInWindow = timestamps.filter(faceTime => {
                // Диагностика: проверяем что timestamps в правильном формате
                if (isNaN(faceTime) || faceTime < 0) {
                  console.log(`   ⚠️ Invalid face timestamp: ${faceTime} for cluster ${cluster.clusterId}`);
                  return false;
                }
                return faceTime >= wordStartSec - BACKWARD_WINDOW_FACE && 
                       faceTime <= wordEndSec + FORWARD_WINDOW_FACE;
              });
              
              if (facesInWindow.length > 0) {
                const count = facePresenceCounts.get(cluster.clusterId) || 0;
                facePresenceCounts.set(cluster.clusterId, count + facesInWindow.length);
              }
            }
          }
          
          // Находим доминирующее лицо для этого speaker
          let maxCount = 0;
          let dominantCluster: FaceCluster | null = null;
          
          for (const [clusterId, count] of facePresenceCounts) {
            if (count > maxCount) {
              maxCount = count;
              dominantCluster = faceClusters.find(c => c.clusterId === clusterId) || null;
            }
          }
          
          if (dominantCluster && dominantCluster.characterName) {
            const totalAppearances = Array.from(facePresenceCounts.values()).reduce((a, b) => a + b, 0);
            const dominance = totalAppearances > 0 ? maxCount / totalAppearances : 0;
            
            // Диагностика для первых 3 speakers
            if (processedSpeakers <= 3) {
              console.log(`   🔍 Speaker ${speakerId}: dominant=${dominantCluster.characterName}, count=${maxCount}, total=${totalAppearances}, dominance=${(dominance * 100).toFixed(1)}%`);
            }
            
            // Добавляем evidence если dominance > 0.3 (хотя бы 30% времени)
            if (dominance > 0.3) {
              facePresenceEvidence.push({
                speakerId,
                faceClusterId: dominantCluster.clusterId,
                characterName: dominantCluster.characterName,
                startMs: words[0]?.startMs || 0,
                endMs: words[words.length - 1]?.endMs || 0,
                dominance,
              });
            }
          }
        }
        
        console.log(`   🔍 Found ${facePresenceEvidence.length} face presence evidence entries`);
        if (facePresenceEvidence.length > 0) {
          console.log(`   📋 Evidence samples (first 5):`);
          facePresenceEvidence.slice(0, 5).forEach(ev => {
            console.log(`      Speaker ${ev.speakerId} → ${ev.characterName} (dominance: ${(ev.dominance * 100).toFixed(1)}%)`);
          });
        } else {
          console.log(`   ⚠️ No face presence evidence found. Possible reasons:`);
          console.log(`      - Face clusters don't have characterName`);
          console.log(`      - Dominance threshold too high (< 30%)`);
          console.log(`      - Face timestamps don't align with speech`);
        }
        
        // Добавляем face presence evidence в mapper
        if (facePresenceEvidence.length > 0) {
          speakerCharacterMapper.addFacePresenceEvidence(facePresenceEvidence);
          console.log(`   ✅ Added face presence evidence for ${facePresenceEvidence.length} speakers`);
          
          // Перестраиваем mapping с новым evidence
          const newMappingResult = speakerCharacterMapper.buildMapping();
          chunkProgress.speakerCharacterMap = speakerCharacterMapper.export();
          logMappingStats(newMappingResult);
        }
      } catch (facePresenceError) {
        console.error(`   ⚠️ Face presence evidence failed:`, facePresenceError);
      }
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
          minSceneDuration: 0.2,  // Немного уменьшили для захвата коротких планов
          maxScenes: 5000,
        });
        
        console.log(`   📊 PySceneDetect RAW: ${rawScenes.length} scenes detected`);
        
        // МИНИМАЛЬНЫЙ мерджинг — только настоящие артефакты (<0.08 сек = 2 кадра)
        // Это ошибки детекции, не реальные планы
        const smartMerged = smartMergeScenes(rawScenes, {
          ultraShortThreshold: 0.08,  // <2 кадра при 25fps — точно артефакт
          shortThreshold: 0.08,       // Не мерджим ничего больше
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
        
        // АУДИО-ДЕТЕКЦИЯ: Находим время первого диалога
        // Заставка заканчивается когда начинаются диалоги!
        let firstDialogueTime: number | undefined;
        if (fullDiarizationWords.length > 0) {
          // Ищем первое "настоящее" слово (не шум, не музыка)
          const firstRealWord = fullDiarizationWords.find(w => 
            w.text && w.text.length >= 2 && /[а-яёa-z]/i.test(w.text)
          );
          if (firstRealWord) {
            firstDialogueTime = firstRealWord.startMs / 1000;
            console.log(`   🎤 First dialogue detected at ${firstDialogueTime.toFixed(1)}s: "${firstRealWord.text}"`);
          }
        }
        
        // Мерджим заставки и титры в ОДИН план (как в реальном монтажном листе!)
        // Используем аудио-детекцию для умного определения конца заставки
        const mergedScenes = mergeCreditsScenes(detectedScenes, videoDuration, videoFPS, {
          skipCreditsMerging: false,
          firstDialogueTime,  // 🎤 Передаём время первого диалога
        });
        chunkProgress.mergedScenes = mergedScenes;
        
        // Подробная статистика потери планов
        const openingMerged = mergedScenes.filter(s => s.type === 'opening_credits').reduce((sum, s) => sum + s.originalScenesCount, 0);
        const closingMerged = mergedScenes.filter(s => s.type === 'closing_credits').reduce((sum, s) => sum + s.originalScenesCount, 0);
        const regularCount = mergedScenes.filter(s => s.type === 'regular').length;
        
        console.log(`   📊 PySceneDetect raw: ${detectedScenes.length} scenes`);
        console.log(`   📊 After credits merge: ${mergedScenes.length} plans`);
        console.log(`   📊 Breakdown:`);
        console.log(`      - Opening credits: ${openingMerged} scenes → 2 plans`);
        console.log(`      - Closing credits: ${closingMerged} scenes → 1 plan`);
        console.log(`      - Regular scenes: ${regularCount} plans`);
        console.log(`   📊 Expected ~1061 plans (real montage sheet)`);
        
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
        // Используем faceTimestamps если есть (worker mode), иначе вычисляем из faces
        faceTimestamps: cluster.faceTimestamps || cluster.faces?.map(f => f.timestamp) || [],
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
