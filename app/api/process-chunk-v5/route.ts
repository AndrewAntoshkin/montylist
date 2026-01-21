/**
 * Process Chunk V5 — Улучшенная обработка чанка (BETA)
 * 
 * Ключевые отличия от V4:
 * 1. Использует pre-built speaker→character mapping
 * 2. Gemini НЕ определяет "кто говорит" — только описание и тип плана
 * 3. Face presence с 3 состояниями для ЗК/ГЗК
 * 4. Диалоги берутся из ASR, а не из Gemini
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// import { getReplicatePool } from '@/lib/replicate-pool'; // Replaced with fal.ai
import { 
  detectFacePresence, 
  formatPresenceStatus,
  type FacePresenceResult,
} from '@/lib/face-presence-detector';
import type { FaceCluster } from '@/lib/face-types';
import { analyzeVideoChunk } from '@/lib/fal-video-understanding';

// 5 minutes timeout
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Types — must match lib/credits-detector.ts MergedScene (snake_case)
interface MergedScene {
  start_timecode: string;
  end_timecode: string;
  start_timestamp: number;
  end_timestamp: number;
  type: 'opening_credits' | 'closing_credits' | 'regular';
  originalScenesCount: number;
}

interface ASRWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speaker?: string;
}

interface DialogueLine {
  character: string;
  text: string;
  isOffscreen: boolean;
  startMs: number;
  endMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { videoId, chunkIndex, chunkUrl, startTimecode, endTimecode } = await request.json();
    
    if (!videoId || chunkIndex === undefined || !chunkUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 V5 BETA CHUNK ${chunkIndex}: ${startTimecode} → ${endTimecode}`);
    console.log(`   Video ID: ${videoId}`);
    console.log(`${'─'.repeat(60)}`);
    
    const supabase = createServiceRoleClient();
    
    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    if (videoError || !video) {
      throw new Error(`Video not found: ${videoId}`);
    }
    
    const chunkProgress = video.chunk_progress_json;
    const sheetId = chunkProgress.sheetId;
    
    // Get video FPS (from init or default to 25)
    const videoFPS = chunkProgress.videoFPS || 25;
    
    // Get pre-built speaker→character mapping from V5 init
    const speakerCharacterMap: Record<string, string> = chunkProgress.speakerCharacterMap || {};
    console.log(`   Speaker→Character mappings: ${Object.keys(speakerCharacterMap).length}`);
    
    // Get face clusters (if available)
    const faceClusters: FaceCluster[] = (chunkProgress.faceClusters || []).map((fc: any) => ({
      clusterId: fc.clusterId,
      appearances: fc.appearances,
      firstSeen: fc.firstSeen,
      lastSeen: fc.lastSeen,
      characterName: fc.characterName,
      centroid: fc.centroid ? new Float32Array(fc.centroid) : new Float32Array(),
      faces: (fc.faceTimestamps || []).map((t: number) => ({ 
        timestamp: t, 
        descriptor: new Float32Array(), 
        confidence: 1, 
        boundingBox: { x: 0, y: 0, width: 0, height: 0 } 
      })),
    }));
    console.log(`   Face clusters: ${faceClusters.length}`);
    
    // Get full diarization words
    const fullDiarizationWords: ASRWord[] = chunkProgress.fullDiarizationWords || [];
    console.log(`   Full diarization words: ${fullDiarizationWords.length}`);
    
    // АВТОМАТИЧЕСКИЙ СБРОС ЗАСТРЯВШИХ ЧАНКОВ
    // Если какой-то чанк в 'triggering' более 60 секунд — сбрасываем в 'pending'
    const TRIGGERING_TIMEOUT_MS = 60 * 1000; // 60 секунд
    const now = Date.now();
    let hadStuckChunks = false;
    
    for (const chunk of chunkProgress.chunks) {
      if (chunk.status === 'triggering' && chunk.triggered_at) {
        const triggeredAt = new Date(chunk.triggered_at).getTime();
        if (now - triggeredAt > TRIGGERING_TIMEOUT_MS) {
          console.log(`   🔄 Auto-reset stuck chunk ${chunk.index} (triggering for ${Math.round((now - triggeredAt) / 1000)}s)`);
          chunk.status = 'pending';
          chunk.triggered_at = undefined;
          chunk.processing_id = null;
          hadStuckChunks = true;
        }
      }
    }
    
    if (hadStuckChunks) {
      await supabase
        .from('videos')
        .update({ chunk_progress_json: chunkProgress })
        .eq('id', videoId);
    }
    
    // ЗАЩИТА ОТ ДУБЛИРОВАНИЯ: Проверяем, не обрабатывается ли чанк уже
    const chunkInfo = chunkProgress.chunks[chunkIndex];
    
    if (!chunkInfo) {
      throw new Error(`Chunk ${chunkIndex} not found in progress`);
    }
    
    if (chunkInfo.status === 'completed') {
      console.log(`   ⚠️  Chunk ${chunkIndex} already completed, skipping duplicate request...`);
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'already_completed',
        chunkIndex,
      });
    }
    
    if (chunkInfo.status === 'in_progress') {
      // Проверяем timeout — если чанк in_progress более 20 минут, считаем его застрявшим
      const STUCK_TIMEOUT_MS = 20 * 60 * 1000; // 20 минут
      const startedAt = chunkInfo.started_at ? new Date(chunkInfo.started_at).getTime() : 0;
      const now = Date.now();
      const isStuck = startedAt > 0 && (now - startedAt) > STUCK_TIMEOUT_MS;
      
      if (isStuck) {
        console.log(`   ⚠️  Chunk ${chunkIndex} stuck for ${Math.round((now - startedAt) / 60000)} min — resetting to pending...`);
        chunkInfo.status = 'pending';
        chunkInfo.started_at = undefined;
        await supabase
          .from('videos')
          .update({ chunk_progress_json: chunkProgress })
          .eq('id', videoId);
        // Продолжаем обработку
      } else {
        console.log(`   ⚠️  Chunk ${chunkIndex} already in progress, skipping duplicate request...`);
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: 'already_in_progress',
          chunkIndex,
        });
      }
    }
    
    // АТОМАРНАЯ БЛОКИРОВКА: используем уникальный processing_id
    // Если после записи ID не совпадает — кто-то другой уже взял чанк
    const processingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previousStatus = chunkInfo.status;
    
    chunkInfo.status = 'in_progress';
    chunkInfo.started_at = new Date().toISOString();
    chunkInfo.processing_id = processingId;
    
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);
    
    // Перечитываем и проверяем что МЫ взяли чанк (а не кто-то другой)
    const { data: verifyData } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const verifiedChunk = verifyData?.chunk_progress_json?.chunks?.[chunkIndex];
    if (verifiedChunk?.processing_id !== processingId) {
      console.log(`   ⚠️  Chunk ${chunkIndex} was taken by another worker (ID mismatch), skipping...`);
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'taken_by_another_worker',
        chunkIndex,
      });
    }
    
    console.log(`   📊 Chunk ${chunkIndex} locked (${previousStatus} → in_progress, ID: ${processingId.slice(-6)})`);
    
    // Get merged scenes
    const mergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    
    // Calculate chunk time range
    const chunkStartMs = parseTimecodeToMs(startTimecode);
    const chunkEndMs = parseTimecodeToMs(endTimecode);
    
    // Get scenes in this chunk (using snake_case from credits-detector)
    const scenesInChunk = mergedScenes.filter(
      s => s.start_timestamp * 1000 >= chunkStartMs - 500 && 
           s.start_timestamp * 1000 < chunkEndMs + 500
    );
    console.log(`   Scenes in chunk: ${scenesInChunk.length}`);
    
    // Calculate global plan offset (scenes before this chunk)
    const scenesBeforeThisChunk = mergedScenes.filter(
      s => s.start_timestamp * 1000 < chunkStartMs - 500
    ).length;
    console.log(`   Plan offset: ${scenesBeforeThisChunk}`);
    
    // Get script data
    const scriptData = chunkProgress.scriptData;
    const characters = scriptData?.characters || [];
    const scriptScenes = scriptData?.scenes || [];
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Call FAL.AI for visual description (no geo-restrictions!)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎬 Calling fal.ai/video-understanding for visual descriptions...`);
    
    let geminiResponse: any = null;
    
    try {
      const falResult = await analyzeVideoChunk(
        chunkUrl,
        scenesInChunk.map(s => ({
          start_timecode: s.start_timecode,
          end_timecode: s.end_timecode
        })),
        characters,
        scriptScenes
      );
      
      if (falResult.success && falResult.plans.length > 0) {
        geminiResponse = { plans: falResult.plans };
        console.log(`   ✅ FAL returned ${falResult.plans.length} plan descriptions`);
      } else if (falResult.rawOutput) {
        console.log(`   ⚠️ FAL returned raw output (no JSON), parsing manually...`);
        // Попробуем извлечь хоть какую-то информацию из rawOutput
        geminiResponse = { plans: [], rawDescription: falResult.rawOutput };
      } else {
        console.log(`   ⚠️ FAL failed: ${falResult.error}`);
      }
    } catch (falError: any) {
      console.log(`   ⚠️ FAL error: ${falError.message}`);
      console.log(`   Continuing without visual descriptions...`);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Build dialogues from ASR (NOT from Gemini)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎤 Building dialogues from ASR...`);
    
    const planDialogues: Map<number, DialogueLine[]> = new Map();
    const usedWords = new Set<string>(); // Дедупликация: слова уже использованные в предыдущих сценах
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      const sceneStartMs = scene.start_timestamp * 1000;
      const sceneEndMs = scene.end_timestamp * 1000;
      
      // Get words in this scene
      // СТРОГИЙ фильтр: слова попадают ТОЛЬКО если их середина внутри сцены
      // НЕТ forward window - это предотвращает "езду" слов в предыдущие сцены
      const BACKWARD_WINDOW_MS = 300; // Назад 300ms (только для обрезанных слов на границе)
      
      let wordsInScene = fullDiarizationWords.filter(w => {
        // Используем середину слова для более точного определения принадлежности к сцене
        const wordMidMs = w.startMs + (w.endMs - w.startMs) / 2;
        
        // Слово попадает в сцену ТОЛЬКО если его середина внутри сцены (с небольшим окном назад)
        // НЕТ forward window - слова не должны "ехать" в предыдущие сцены
        const isMidInScene = wordMidMs >= sceneStartMs - BACKWARD_WINDOW_MS && 
                            wordMidMs <= sceneEndMs;
        
        // ИЛИ начало слова в сцене (для коротких слов на границе)
        const isStartInScene = w.startMs >= sceneStartMs - BACKWARD_WINDOW_MS && 
                              w.startMs <= sceneEndMs;
        
        return isMidInScene || isStartInScene;
      });
      
      // Дедупликация: удаляем слова уже использованные в предыдущих сценах
      // Это предотвращает "езду" слов между соседними сценами
      wordsInScene = wordsInScene.filter(w => {
        const wordKey = `${w.startMs}-${w.endMs}-${w.text}-${w.speaker}`;
        if (usedWords.has(wordKey)) {
          return false; // Уже использовано в предыдущей сцене
        }
        usedWords.add(wordKey); // Помечаем как использованное
        return true;
      });
      
      // Log scene info for debugging
      const sceneTimecode = `${Math.floor(sceneStartMs / 60000)}:${Math.floor((sceneStartMs % 60000) / 1000).toString().padStart(2, '0')}:${Math.floor((sceneStartMs % 1000) / 10).toString().padStart(2, '0')}`;
      
      // DEBUG: Показываем спикеров в каждой сцене первых 10 минут
      const isEarlyScene = sceneStartMs < 600000; // Первые 10 минут
      if (isEarlyScene && sceneIndex % 10 === 0) {
        // Показываем каждую 10-ю сцену для экономии логов
        const speakersInScene = [...new Set(wordsInScene.map(w => w.speaker).filter((s): s is string => !!s))];
        const speakersMapped = speakersInScene.map(s => `${s}→${speakerCharacterMap[s] || '?'}`);
        console.log(`   📊 Scene ${sceneIndex} (${sceneTimecode}): ${wordsInScene.length} words, speakers: [${speakersMapped.join(', ')}]`);
      }
      
      // Filter out false positives (music, credits, background noise)
      const FALSE_POSITIVE_PATTERNS = [
        /^музыка/i,           // Changed from /^музыка$/i to catch "МУЗЫКА...."
        /^динамичн/i,
        /^наслаждай/i,
        /^титр/i,
        /^автор/i,
        /^режиссер/i,
        /^оператор/i,
        /^продюсер/i,
        /^телекомпания/i,
        /^партнер/i,
        /^домашний/i,
        /^представляет/i,
        /^логотип/i,
        /^заставка/i,
      ];
      
      // Helper to clean text for pattern matching
      const cleanText = (text: string): string => {
        return text
          .trim()
          .replace(/[.!?…]+/g, '') // Remove dots, ellipsis
          .replace(/\s+/g, ' ')     // Normalize whitespace
          .toLowerCase();
      };
      
      wordsInScene = wordsInScene.filter(w => {
        const text = (w.text || '').trim();
        // СНИЖЕН порог с 2 до 1 для лучшего покрытия коротких слов
        if (!text || text.length < 1) return false;
        
        const cleaned = cleanText(text);
        
        // Filter words that match false positive patterns (after cleaning)
        if (FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(cleaned))) {
          return false;
        }
        
        // Filter very short words that are likely noise (только не-русские)
        // УБРАН фильтр для русских слов любой длины
        if (text.length <= 1 && !/[а-яё]/i.test(text)) {
          return false;
        }
        
        return true;
      });
      
      // DEBUG: Детальный лог для проблемных таймкодов (03:00-03:10 и 06:00-06:30)
      const isProblematicTimecode = 
        (sceneStartMs >= 180000 && sceneStartMs <= 190000) ||  // 03:00-03:10
        (sceneStartMs >= 360000 && sceneStartMs <= 390000);    // 06:00-06:30
      
      if (isProblematicTimecode && wordsInScene.length > 0) {
        const uniqueSpeakers = [...new Set(wordsInScene.map(w => w.speaker).filter((s): s is string => !!s))];
        console.log(`\n   🎯 PROBLEM ZONE Scene ${sceneIndex} (${sceneTimecode}):`);
        console.log(`      Words count: ${wordsInScene.length}`);
        console.log(`      Speakers: [${uniqueSpeakers.join(', ')}]`);
        console.log(`      Speaker→Character mapping:`);
        uniqueSpeakers.forEach(sp => {
          const char = speakerCharacterMap[sp];
          console.log(`         ${sp} → ${char || '❌ NOT MAPPED'}`);
        });
        console.log(`      First 5 words: ${wordsInScene.slice(0, 5).map(w => `"${w.text}"`).join(', ')}`);
      }
      
      // Group by speaker with pause detection for accurate dialogue splitting
      const dialogues: DialogueLine[] = [];
      let currentDialogue: DialogueLine | null = null;
      // УВЕЛИЧЕНО с 500ms до 1000ms чтобы не разбивать одну реплику на несколько
      // Это исправляет проблему разбиения одной реплики (например, "А мой..." разбита на несколько планов)
      const PAUSE_THRESHOLD_MS = 1000; // Пауза >1000ms = новая реплика (увеличено для сохранения целостности реплик)
      
      for (let i = 0; i < wordsInScene.length; i++) {
        const word = wordsInScene[i];
        const speaker = word.speaker || 'UNKNOWN';
        const character = speakerCharacterMap[speaker] || speaker;
        
        // Log mapping for debugging (first few scenes and problematic timecodes)
        const isFirstMinute = word.startMs >= 60000 && word.startMs <= 90000; // 1:00 - 1:30
        const isProblematicTime = word.startMs >= 15 * 60 * 1000 && word.startMs <= 15 * 60 * 1000 + 5 * 1000;
        if (isFirstMinute || isProblematicTime || sceneTimecode.includes('15:01') || sceneTimecode.includes('15:02') || sceneTimecode.includes('01:06') || sceneTimecode.includes('01:09')) {
          const isMapped = !!speakerCharacterMap[speaker];
          // Inline timecode formatting (msToTimecode defined later in file)
          const wordTimecode = `${Math.floor(word.startMs / 60000)}:${String(Math.floor((word.startMs % 60000) / 1000)).padStart(2, '0')}`;
          const sceneTimecodeForWord = `${Math.floor(sceneStartMs / 60000)}:${Math.floor((sceneStartMs % 60000) / 1000).toString().padStart(2, '0')}:${Math.floor((sceneStartMs % 1000) / 10).toString().padStart(2, '0')}`;
          console.log(`   🔍 [${wordTimecode}] Word "${word.text?.slice(0, 20)}" (${speaker} → ${character}, mapped: ${isMapped}) → Scene ${sceneIndex} (${sceneTimecodeForWord})`);
        }
        
        // Check for pause between words (same speaker) - split dialogue if pause > threshold
        const prevWord = i > 0 ? wordsInScene[i - 1] : null;
        const pauseBeforeWord = prevWord && prevWord.speaker === speaker 
          ? word.startMs - prevWord.endMs 
          : Infinity;
        const shouldSplitByPause = pauseBeforeWord > PAUSE_THRESHOLD_MS;
        
        // Check face presence for ЗК
        // ВАЖНО: ЗК только если у персонажа ЕСТЬ привязанное лицо И его нет в кадре
        // И только если уверенность высокая (>0.8) и это именно лицо этого персонажа отсутствует
        let isOffscreen = false;
        if (faceClusters.length > 0) {
          // Проверяем, есть ли у этого персонажа привязанное лицо
          const characterFaceCluster = faceClusters.find(fc => fc.characterName === character);
          const characterHasBoundFace = !!characterFaceCluster;
          
          if (characterHasBoundFace && characterFaceCluster) {
            const facePresence = detectFacePresence(
              { startMs: word.startMs, endMs: word.endMs, speakerId: speaker },
              faceClusters,
              new Map(Object.entries(speakerCharacterMap).map(([k, v]) => {
                const faceCluster = faceClusters.find(fc => fc.characterName === v);
                return [faceCluster?.clusterId || k, v];
              }))
            );
            
            // Проверяем, есть ли лицо ЭТОГО персонажа в окне
            const characterFaceInWindow = facePresence.facesInWindow.includes(characterFaceCluster.clusterId);
            
            // ЗК только если:
            // 1. Явно OFFSCREEN (не AMBIGUOUS)
            // 2. Высокая уверенность (>0.8, повышен порог)
            // 3. Лицо ЭТОГО персонажа отсутствует в окне
            // 4. Нет других лиц в кадре (чтобы не путать с диалогом между персонажами)
            const hasOtherFaces = facePresence.facesInWindow.length > 1;
            isOffscreen = facePresence.status === 'OFFSCREEN' && 
                         facePresence.confidence > 0.8 && // Повышен порог
                         !characterFaceInWindow &&         // Лицо персонажа отсутствует
                         !hasOtherFaces;                   // Нет других лиц
          }
          // Если у персонажа нет привязанного лица — НЕ ставим ЗК (неизвестно)
        }
        
        // Split dialogue if: different character OR pause > threshold
        const shouldStartNewDialogue = !currentDialogue || 
                                      currentDialogue.character !== character || 
                                      shouldSplitByPause;
        
        if (shouldStartNewDialogue) {
          // Сохраняем предыдущий диалог только если он валидный
          if (currentDialogue && currentDialogue.text.trim()) {
            const dialogueText = currentDialogue.text.trim();
            const cleaned = cleanText(dialogueText);
            // Фильтруем слишком короткие диалоги (< 2 символов) и ложные паттерны
            // СНИЖЕН порог с 3 до 2 для лучшего покрытия коротких реплик
            const isValidDialogue = dialogueText.length >= 2 && 
                                   !FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(cleaned));
            if (isValidDialogue) {
              dialogues.push(currentDialogue);
            }
          }
          // Start new dialogue with EXACT timestamps from first word
          currentDialogue = {
            character,
            text: word.text,
            isOffscreen,
            startMs: word.startMs,  // ТОЧНЫЙ таймкод начала (из ASR)
            endMs: word.endMs,      // ТОЧНЫЙ таймкод конца (из ASR)
          };
        } else if (currentDialogue) {
          // Continue current dialogue - append text and update end time
          currentDialogue.text += ' ' + word.text;
          currentDialogue.endMs = word.endMs;  // Обновляем конец на последнее слово
        }
      }
      
      // Финальная проверка последнего диалога
      if (currentDialogue && currentDialogue.text.trim()) {
        const dialogueText = currentDialogue.text.trim();
        const cleaned = cleanText(dialogueText);
        // СНИЖЕН порог с 3 до 2 для лучшего покрытия коротких реплик
        const isValidDialogue = dialogueText.length >= 2 && 
                               !FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(cleaned));
        if (isValidDialogue) {
          dialogues.push(currentDialogue);
        }
      }
      
      planDialogues.set(sceneIndex, dialogues);
      
      // Log empty scenes for debugging
      if (dialogues.length === 0 && wordsInScene.length > 0) {
        const sceneTimecode = `${Math.floor(sceneStartMs / 60000)}:${Math.floor((sceneStartMs % 60000) / 1000)}:${Math.floor((sceneStartMs % 1000) / 10)}`;
        if (sceneTimecode.includes('15:01') || sceneTimecode.includes('15:02') || sceneTimecode.includes('15:03') || sceneTimecode.includes('15:04')) {
          console.log(`   ⚠️ Scene ${sceneIndex} (${sceneTimecode}): ${wordsInScene.length} words but 0 dialogues (filtered out?)`);
        }
      }
    }
    
    console.log(`   Built dialogues for ${planDialogues.size} scenes`);
    
    // Log sample dialogues for debugging
    const samplePlans = Array.from(planDialogues.entries()).slice(0, 3);
    if (samplePlans.length > 0) {
      console.log(`\n   📋 Sample dialogues (first 3):`);
      for (const [idx, dialogues] of samplePlans) {
        const scene = scenesInChunk[idx];
        const sample = dialogues.slice(0, 2).map(d => 
          `${d.character}${d.isOffscreen ? ' ЗК' : ''}: "${d.text.slice(0, 50)}..."`
        ).join(', ');
        console.log(`      Plan ${idx + 1} (${scene?.start_timecode}): ${sample || '(нет диалогов)'}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Create montage entries
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n📝 Creating montage entries...`);
    
    let plansCreated = 0;
    const geminiHints: Record<string, number> = {}; // Собираем статистику по Gemini hints
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      
      // Get Gemini description for this plan (by index)
      const geminiPlan = geminiResponse?.plans?.[sceneIndex];
      
      // Если Gemini определил говорящего персонажа — собираем статистику (без отдельного лога)
      const geminiSpeakingCharacter = geminiPlan?.speakingCharacter?.toUpperCase();
      if (geminiSpeakingCharacter && characters.some((c: any) => c.name?.toUpperCase() === geminiSpeakingCharacter)) {
        geminiHints[geminiSpeakingCharacter] = (geminiHints[geminiSpeakingCharacter] || 0) + 1;
      }
      
      // Get dialogues for this plan
      let dialogues = planDialogues.get(sceneIndex) || [];
      
      // Если ASR не уверен в персонаже, но Gemini подсказал — используем подсказку
      if (geminiSpeakingCharacter && dialogues.length > 0) {
        const updatedDialogues = dialogues.map(d => {
          // Если персонаж не определён или это UNKNOWN — используем подсказку Gemini
          if (!d.character || d.character === 'UNKNOWN' || d.character === '???') {
            return { ...d, character: geminiSpeakingCharacter, geminiHint: true };
          }
          return d;
        });
        dialogues = updatedDialogues;
      }
      
      // Format dialogues with EXACT timestamps
      const dialogueText = dialogues
        .map(d => {
          const suffix = d.isOffscreen ? formatPresenceStatus('OFFSCREEN') : '';
          return `${d.character}${suffix}\n${d.text}`;
        })
        .join('\n\n');
      
      // ВАЖНО: Всегда используем границы сцены из PySceneDetect (он правильно определяет планы)
      // Таймкоды диалогов используются только для точности внутри сцены, но не заменяют границы сцены
      // Это гарантирует, что мы не потеряем ни одного плана из PySceneDetect
      
      // Convert milliseconds to timecode format (HH:MM:SS:FF)
      const msToTimecode = (ms: number, fps: number = 25): string => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const frames = Math.floor((ms % 1000) / (1000 / fps));
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
      };
      
      // Используем границы сцены из PySceneDetect (это правильно определённые планы)
      let exactStartTimecode = scene.start_timecode;
      let exactEndTimecode = scene.end_timecode;
      
      // Если есть диалоги, можем уточнить таймкоды, но НЕ выходим за границы сцены
      if (dialogues.length > 0) {
        const firstDialogue = dialogues[0];
        const lastDialogue = dialogues[dialogues.length - 1];
        
        const dialogueStartTimecode = msToTimecode(firstDialogue.startMs, videoFPS);
        const dialogueEndTimecode = msToTimecode(lastDialogue.endMs, videoFPS);
        
        // Используем таймкоды диалогов, но НЕ выходим за границы сцены
        // Это гарантирует, что план соответствует сцене из PySceneDetect
        // Но таймкоды более точные (когда диалоги начинаются/заканчиваются)
        const sceneStartMs = scene.start_timestamp * 1000;
        const sceneEndMs = scene.end_timestamp * 1000;
        
        // Уточняем начало: используем начало диалога, если оно внутри или на границе сцены
        // Если диалог начинается раньше сцены (из-за контекстного окна), используем границу сцены
        if (firstDialogue.startMs >= sceneStartMs && firstDialogue.startMs <= sceneEndMs) {
          exactStartTimecode = dialogueStartTimecode;
        }
        // Иначе остаётся scene.start_timecode (уже установлено выше)
        
        // Уточняем конец: используем конец диалога, если он внутри или на границе сцены
        // Если диалог заканчивается позже сцены, используем границу сцены
        if (lastDialogue.endMs <= sceneEndMs && lastDialogue.endMs >= sceneStartMs) {
          exactEndTimecode = dialogueEndTimecode;
        }
        // Иначе остаётся scene.end_timecode (уже установлено выше)
      }
      
      // Create entry — use same field names as V4 for compatibility
      // Global plan number = offset + local index + 1
      const planNumber = scenesBeforeThisChunk + sceneIndex + 1;
      const entryData = {
        sheet_id: sheetId,
        plan_number: planNumber,
        order_index: planNumber,
        start_timecode: exactStartTimecode,  // ТОЧНЫЙ таймкод из диалога
        end_timecode: exactEndTimecode,      // ТОЧНЫЙ таймкод из диалога
        plan_type: geminiPlan?.planType || 'Ср.',
        description: geminiPlan?.description || '',
        dialogues: dialogueText || '',
        // V5 metadata (optional columns)
        processing_version: 'v5-beta',
        dialogue_source: 'asr',
        speaker_mapped: dialogues.some(d => !!speakerCharacterMap[d.character]),
      };
      
      // Upsert entry
      const { error: entryError } = await supabase
        .from('montage_entries')
        .upsert(entryData, {
          onConflict: 'sheet_id,plan_number',
        });
      
      if (entryError) {
        console.error(`   ❌ Entry error for plan ${planNumber} (scene ${sceneIndex}):`, entryError);
        // КРИТИЧНО: Не пропускаем план даже при ошибке - логируем для анализа
        console.error(`   ⚠️  MISSING PLAN: sceneIndex=${sceneIndex}, planNumber=${planNumber}, timecode=${exactStartTimecode}`);
      } else {
        plansCreated++;
      }
    }
    
    // КРИТИЧНАЯ ПРОВЕРКА: Убеждаемся, что создали entry для ВСЕХ сцен
    // PySceneDetect нашёл 1065 планов, реальный лист имеет 1061 - разница всего 4!
    // НЕ ДОЛЖНЫ ТЕРЯТЬ ПЛАНЫ!
    const expectedPlans = scenesInChunk.length;
    if (plansCreated !== expectedPlans) {
      console.error(`\n   ⚠️  ⚠️  ⚠️  КРИТИЧЕСКАЯ ПРОБЛЕМА: Потеря планов! ⚠️  ⚠️  ⚠️`);
      console.error(`   Ожидалось планов: ${expectedPlans}`);
      console.error(`   Создано планов: ${plansCreated}`);
      console.error(`   ПОТЕРЯНО: ${expectedPlans - plansCreated} планов!`);
      console.error(`   Chunk: ${chunkIndex}, Scenes: ${scenesInChunk.length}, Plan offset: ${scenesBeforeThisChunk}`);
    }
    
    // Сводка по Gemini hints (компактно)
    const hintsCount = Object.values(geminiHints).reduce((sum, n) => sum + n, 0);
    if (hintsCount > 0) {
      const hintsSummary = Object.entries(geminiHints)
        .sort((a, b) => b[1] - a[1])
        .map(([char, count]) => `${char}:${count}`)
        .join(', ');
      console.log(`   🎯 Gemini hints (${hintsCount}): ${hintsSummary}`);
    }
    
    // Всегда выводим формат X/Y для отслеживания
    if (plansCreated === expectedPlans) {
      console.log(`   ✅ Created ${plansCreated}/${expectedPlans} entries (все планы созданы)`);
    } else {
      console.log(`   ⚠️  Created ${plansCreated}/${expectedPlans} entries (НЕ ВСЕ ПЛАНЫ!)`);
    }
    
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Chunk ${chunkIndex} complete in ${processingTime}s`);
    console.log(`   Plans created: ${plansCreated}`);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Trigger next chunk or finalize (with race condition protection)
    // ═══════════════════════════════════════════════════════════════════
    
    // RE-READ fresh state to avoid race conditions
    const { data: freshVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const freshProgress = freshVideo?.chunk_progress_json || chunkProgress;
    
    // Update our chunk as completed in fresh state
    freshProgress.chunks[chunkIndex].status = 'completed';
    freshProgress.completedChunks = freshProgress.chunks.filter(
      (c: any) => c.status === 'completed'
    ).length;
    
    // Check for pending chunks (включая failed с retry < 3)
    const MAX_CHUNK_RETRIES = 3;
    const pendingChunks = freshProgress.chunks.filter(
      (c: any) => {
        // Ready или pending чанки (НЕ triggering — он уже взят)
        if ((c.status === 'ready' || c.status === 'pending') && c.storageUrl) return true;
        // Failed чанки с retry < 3
        if (c.status === 'failed' && (c.retryCount || 0) < MAX_CHUNK_RETRIES && c.storageUrl) {
          console.log(`   🔄 Will retry failed chunk ${c.index} (attempt ${(c.retryCount || 0) + 1}/${MAX_CHUNK_RETRIES})`);
          return true;
        }
        // Проверяем застрявшие 'triggering' — если >30 сек, запрос не дошёл
        if (c.status === 'triggering' && c.storageUrl) {
          const triggeredAt = c.triggered_at ? new Date(c.triggered_at).getTime() : 0;
          const isStuckTriggering = triggeredAt > 0 && (Date.now() - triggeredAt) > 30000;
          if (isStuckTriggering) {
            console.log(`   ⚠️  Chunk ${c.index} stuck in triggering >30s, resetting...`);
            c.status = 'pending';
            return true;
          }
        }
        return false;
      }
    );
    const inProgressChunks = freshProgress.chunks.filter(
      (c: any) => c.status === 'in_progress' || c.status === 'triggering'
    );
    
    const MAX_CONCURRENT = 3;
    const canTriggerMore = inProgressChunks.length < MAX_CONCURRENT && pendingChunks.length > 0;
    
    // Диагностика: логируем состояние для отладки
    if (pendingChunks.length > 0 && !canTriggerMore) {
      console.log(`   ⚠️ Can't trigger next chunk: ${inProgressChunks.length}/${MAX_CONCURRENT} in progress, ${pendingChunks.length} pending`);
    }
    
    if (canTriggerMore) {
      // Trigger next pending chunk (fire-and-forget)
      const nextChunk = pendingChunks[0];
      const isRetry = nextChunk.status === 'failed';
      
      console.log(`\n🔄 Triggering ${isRetry ? 'RETRY' : 'next'} chunk ${nextChunk.index + 1} (${pendingChunks.length} pending, ${inProgressChunks.length}/${MAX_CONCURRENT} in progress)...`);
      
      // АТОМАРНАЯ БЛОКИРОВКА: помечаем чанк как 'triggering' СРАЗУ
      // Это предотвращает дублирование если два воркера завершились одновременно
      freshProgress.chunks[nextChunk.index].status = 'triggering';
      freshProgress.chunks[nextChunk.index].triggered_at = new Date().toISOString();
    }
    
    // Save updated progress (atomic update)
    await supabase
      .from('videos')
      .update({ chunk_progress_json: freshProgress })
      .eq('id', videoId);
    
    console.log(`   Progress: ${freshProgress.completedChunks}/${freshProgress.totalChunks}`);
    
    // Now trigger if needed (after DB is updated)
    if (canTriggerMore) {
      const nextChunk = pendingChunks[0];
      
      // Build base URL from request (use localhost for internal calls)
      const requestUrl = new URL(request.url);
      // Use localhost for internal calls to avoid network issues
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                     (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1'
                       ? `${requestUrl.protocol}//${requestUrl.host}`
                       : `http://localhost:${process.env.PORT || 3000}`);
      
      // Trigger with retry mechanism
      const triggerWithRetry = async (maxRetries = 3, timeout = 10000) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            await fetch(`${baseUrl}/api/process-chunk-v5`, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'x-internal-request': 'true',
              },
              body: JSON.stringify({
                videoId,
                chunkIndex: nextChunk.index,
                chunkUrl: nextChunk.storageUrl,
                startTimecode: nextChunk.startTimecode,
                endTimecode: nextChunk.endTimecode,
              }),
              signal: controller.signal,
            });
            
            clearTimeout(timeoutId);
            console.log(`   ✅ Triggered chunk ${nextChunk.index + 1}`);
            return; // Success!
          } catch (err: any) {
            if (attempt < maxRetries) {
              const delay = attempt * 2000; // 2s, 4s
              console.log(`   ⚠️ Chunk ${nextChunk.index + 1} trigger attempt ${attempt} failed, retrying in ${delay/1000}s...`);
              await new Promise(r => setTimeout(r, delay));
            } else {
              console.error(`   ❌ Chunk ${nextChunk.index + 1} trigger failed after ${maxRetries} attempts`);
              // Reset chunk status to pending so it can be retried
              try {
                const { data: currentVideo } = await supabase
                  .from('videos')
                  .select('chunk_progress_json')
                  .eq('id', videoId)
                  .single();
                
                if (currentVideo?.chunk_progress_json) {
                  const progress = currentVideo.chunk_progress_json;
                  const chunkStatus = progress.chunks[nextChunk.index]?.status;
                  // Only reset if still in triggering state (not picked up by another worker)
                  if (chunkStatus === 'triggering') {
                    progress.chunks[nextChunk.index].status = 'pending';
                    progress.chunks[nextChunk.index].processing_id = null;
                    await supabase
                      .from('videos')
                      .update({ chunk_progress_json: progress })
                      .eq('id', videoId);
                    console.log(`   🔄 Reset chunk ${nextChunk.index + 1} to pending for retry`);
                  }
                }
              } catch (resetErr) {
                console.error(`   ❌ Failed to reset chunk status:`, resetErr);
              }
            }
          }
        }
      };
      
      // Fire and forget but with retry
      triggerWithRetry().catch(() => {});
    }
    
    // Auto-finalize when all chunks are done
    // ВАЖНО: используем freshProgress, а не старый chunkProgress!
    if (freshProgress.completedChunks === freshProgress.totalChunks) {
      console.log(`\n🏁 All chunks complete! Finalizing video...`);
      console.log(`   completedChunks: ${freshProgress.completedChunks}/${freshProgress.totalChunks}`);
      
      try {
        // Update video status
        await supabase
          .from('videos')
          .update({ status: 'completed' })
          .eq('id', videoId);
        
        // Update sheet status
        await supabase
          .from('montage_sheets')
          .update({ status: 'ready' })
          .eq('id', freshProgress.sheetId);
        
        console.log(`✅ Video finalized successfully!`);
      } catch (finalizeError) {
        console.error(`❌ Finalize error:`, finalizeError);
      }
    }
    
    return NextResponse.json({
      success: true,
      chunkIndex,
      plansCreated,
      processingTime,
      completedChunks: chunkProgress.completedChunks,
      totalChunks: chunkProgress.totalChunks,
    });
    
  } catch (error) {
    console.error('❌ Process chunk V5 error:', error);
    
    // ВАЖНО: При ошибке сбрасываем статус чанка, чтобы его можно было повторить
    try {
      const supabase = createServiceRoleClient();
      const body = await request.clone().json().catch(() => ({}));
      const { videoId, chunkIndex } = body;
      
      if (videoId && chunkIndex !== undefined) {
        const { data: video } = await supabase
          .from('videos')
          .select('chunk_progress_json')
          .eq('id', videoId)
          .single();
        
        if (video?.chunk_progress_json?.chunks?.[chunkIndex]) {
          video.chunk_progress_json.chunks[chunkIndex].status = 'failed';
          video.chunk_progress_json.chunks[chunkIndex].error = error instanceof Error ? error.message : 'Unknown error';
          video.chunk_progress_json.chunks[chunkIndex].failed_at = new Date().toISOString();
          
          await supabase
            .from('videos')
            .update({ chunk_progress_json: video.chunk_progress_json })
            .eq('id', videoId);
          
          console.log(`   📛 Chunk ${chunkIndex} marked as failed (can be retried)`);
        }
      }
    } catch (resetError) {
      console.error('   ⚠️ Failed to reset chunk status:', resetError);
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chunk' },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function parseTimecodeToMs(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  if (parts.length === 4) {
    const [h, m, s, f] = parts;
    return (h * 3600 + m * 60 + s) * 1000 + (f * 1000 / 24);
  }
  return 0;
}

function buildV5Prompt(scenes: MergedScene[], characters: any[], scriptScenes?: any[]): string {
  const characterList = characters.slice(0, 15).map(c => {
    // Добавляем описание персонажа если есть
    const desc = c.description ? ` (${c.description.slice(0, 50)})` : '';
    return `${c.name}${desc}`;
  }).join('\n- ');
  
  // Находим релевантные сцены из сценария (если есть)
  let sceneContext = '';
  if (scriptScenes && scriptScenes.length > 0) {
    const relevantScenes = scriptScenes.slice(0, 5).map(s => {
      const chars = s.characters?.length > 0 ? s.characters.join(', ') : 'не указаны';
      return `  • ${s.sceneNumber} ${s.location}: ${chars}`;
    }).join('\n');
    sceneContext = `\nСЦЕНЫ ИЗ СЦЕНАРИЯ (персонажи в каждой сцене):\n${relevantScenes}\n`;
  }
  
  return `Ты монтажёр. Проанализируй видео и опиши ВИЗУАЛЬНУЮ ИНФОРМАЦИЮ для каждого плана.

ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ:
- ${characterList || 'не указаны'}
${sceneContext}
ВАЖНО: 
- Описывай что ВИДНО в кадре
- Определяй тип плана (Кр./Ср./Общ./Деталь)
- Если видишь говорящего персонажа — опиши его внешность
- Если можешь определить КТО говорит по губам/жестам — укажи в поле "speakingCharacter"

ПЛАНЫ ДЛЯ АНАЛИЗА:
${scenes.map((s, i) => `План ${i + 1}: ${s.start_timecode} - ${s.end_timecode}`).join('\n')}

ФОРМАТ ОТВЕТА (JSON):
{
  "plans": [
    {
      "planNumber": 1,
      "planType": "Ср.",
      "description": "Женщина в золотом платье стоит у стойки ресепшн",
      "visualCharacters": ["женщина в золотом", "мужчина в костюме"],
      "speakingCharacter": "ГАЛИНА",
      "location": "холл салона"
    }
  ]
}

Ответь ТОЛЬКО JSON, без markdown.`;
}

function parseGeminiOutput(output: any): any {
  try {
    let text = '';
    if (Array.isArray(output)) {
      text = output.join('');
    } else if (typeof output === 'string') {
      text = output;
    } else {
      return { plans: [] };
    }
    
    // Clean markdown
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    
    // Find JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { plans: [] };
  } catch (e) {
    console.error('Failed to parse Gemini output:', e);
    return { plans: [] };
  }
}
