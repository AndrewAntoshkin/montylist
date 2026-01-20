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
import { getReplicatePool } from '@/lib/replicate-pool';
import { 
  detectFacePresence, 
  formatPresenceStatus,
  type FacePresenceResult,
} from '@/lib/face-presence-detector';
import type { FaceCluster } from '@/lib/face-types';

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
    
    // Get merged scenes
    const mergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    
    // Calculate chunk time range
    const chunkInfo = chunkProgress.chunks[chunkIndex];
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
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Call Gemini for visual description ONLY (with retry)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🤖 Calling Gemini for visual descriptions...`);
    
    let geminiResponse: any = null;
    const MAX_RETRIES = 2; // Reduced from 3 to 2 for faster failure
    const GEMINI_TIMEOUT = 60000; // 60 seconds max per attempt
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const replicatePool = getReplicatePool();
        const { client: replicate, release } = await replicatePool.getLeastLoadedClient();
        
        // V5 prompt: ТОЛЬКО описание и тип плана, НЕ диалоги
        const v5Prompt = buildV5Prompt(scenesInChunk, characters);
        
        try {
          // Add timeout wrapper
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Gemini timeout after 60s')), GEMINI_TIMEOUT);
          });
          
          const output = await Promise.race([
            replicate.run(
              "google/gemini-2.5-flash",  // Faster and cheaper for visual descriptions
              {
                input: {
                  prompt: v5Prompt,
                  videos: [chunkUrl],  // gemini-2.5-flash expects array
                  temperature: 0.3,
                  max_tokens: 4000, // Reduced from 8000 for faster processing
                }
              }
            ),
            timeoutPromise
          ]) as any;
          
          geminiResponse = parseGeminiOutput(output);
          console.log(`   ✅ Gemini returned ${geminiResponse?.plans?.length || 0} plan descriptions`);
          break; // Success, exit retry loop
        } finally {
          release(); // Always release the client
        }
        
      } catch (geminiError: any) {
        const isNetworkError = geminiError?.cause?.code === 'UND_ERR_SOCKET' ||
                               geminiError?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
                               geminiError?.message?.includes('fetch failed') ||
                               geminiError?.message?.includes('timeout');
        
        if (isNetworkError && attempt < MAX_RETRIES) {
          const delay = attempt * 3000; // Reduced: 3s, 6s (was 5s, 10s, 15s)
          console.log(`   ⚠️ Network/timeout error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay/1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.log(`   ⚠️ Gemini failed after ${attempt} attempts, continuing without visual descriptions`);
          // Continue without Gemini descriptions - dialogues from ASR are more important
          break; // Exit retry loop, continue processing
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Build dialogues from ASR (NOT from Gemini)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎤 Building dialogues from ASR...`);
    
    const planDialogues: Map<number, DialogueLine[]> = new Map();
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      const sceneStartMs = scene.start_timestamp * 1000;
      const sceneEndMs = scene.end_timestamp * 1000;
      
      // Get words in this scene
      let wordsInScene = fullDiarizationWords.filter(
        w => w.startMs >= sceneStartMs - 500 && w.endMs <= sceneEndMs + 500
      );
      
      // Log scene info for debugging (only for problematic timecodes)
      const sceneTimecode = `${Math.floor(sceneStartMs / 60000)}:${Math.floor((sceneStartMs % 60000) / 1000)}:${Math.floor((sceneStartMs % 1000) / 10)}`;
      if (sceneTimecode.includes('15:01') || sceneTimecode.includes('15:02') || sceneTimecode.includes('15:03') || sceneTimecode.includes('15:04')) {
        console.log(`   🔍 Scene ${sceneIndex} (${sceneTimecode}): ${wordsInScene.length} words before filtering`);
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
      
      // Group by speaker with pause detection for accurate dialogue splitting
      const dialogues: DialogueLine[] = [];
      let currentDialogue: DialogueLine | null = null;
      const PAUSE_THRESHOLD_MS = 500; // Пауза >500ms = новая реплика (для точного разбиения)
      
      for (let i = 0; i < wordsInScene.length; i++) {
        const word = wordsInScene[i];
        const speaker = word.speaker || 'UNKNOWN';
        const character = speakerCharacterMap[speaker] || speaker;
        
        // Log mapping for debugging (only for problematic timecodes)
        const isProblematicTime = word.startMs >= 15 * 60 * 1000 && word.startMs <= 15 * 60 * 1000 + 5 * 1000;
        if (isProblematicTime || sceneTimecode.includes('15:01') || sceneTimecode.includes('15:02')) {
          const isMapped = !!speakerCharacterMap[speaker];
          console.log(`   🔍 Word "${word.text?.slice(0, 20)}" (${speaker} → ${character}, mapped: ${isMapped})`);
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
        } else {
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
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      
      // Get Gemini description for this plan (by index)
      const geminiPlan = geminiResponse?.plans?.[sceneIndex];
      
      // Get dialogues for this plan
      const dialogues = planDialogues.get(sceneIndex) || [];
      
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
    
    // Check for pending chunks
    const pendingChunks = freshProgress.chunks.filter(
      (c: any) => (c.status === 'ready' || c.status === 'pending') && c.storageUrl
    );
    const inProgressChunks = freshProgress.chunks.filter(
      (c: any) => c.status === 'in_progress'
    );
    
    const MAX_CONCURRENT = 3;
    const canTriggerMore = inProgressChunks.length < MAX_CONCURRENT && pendingChunks.length > 0;
    
    if (canTriggerMore) {
      // Trigger next pending chunk (fire-and-forget)
      const nextChunk = pendingChunks[0];
      console.log(`\n🔄 Triggering next chunk ${nextChunk.index + 1} (${pendingChunks.length} pending)...`);
      
      // Mark as in_progress BEFORE saving to prevent race condition
      freshProgress.chunks[nextChunk.index].status = 'in_progress';
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
      
      // Fire and forget with timeout (compatible with Node.js 18+)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
      
      fetch(`${baseUrl}/api/process-chunk-v5`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          // Pass internal header to avoid middleware checks
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
      })
      .then(() => {
        clearTimeout(timeoutId);
        console.log(`   ✅ Triggered chunk ${nextChunk.index + 1}`);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        // Don't log AbortError (timeout) as error - it's expected for fire-and-forget
        if (err.name !== 'AbortError') {
          console.error(`   ❌ Failed to trigger chunk ${nextChunk.index + 1}:`, err.message);
        }
        // Chunk will be picked up by another worker or manual retry
      });
    }
    
    // Auto-finalize when all chunks are done
    if (chunkProgress.completedChunks === chunkProgress.totalChunks) {
      console.log(`\n🏁 All chunks complete! Finalizing video...`);
      
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
          .eq('id', chunkProgress.sheetId);
        
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

function buildV5Prompt(scenes: MergedScene[], characters: any[]): string {
  const characterList = characters.slice(0, 10).map(c => c.name).join(', ');
  
  return `Ты монтажёр. Проанализируй видео и опиши ВИЗУАЛЬНУЮ ИНФОРМАЦИЮ для каждого плана.

ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ: ${characterList || 'не указаны'}

ВАЖНО: 
- НЕ определяй кто говорит — это делается через аудио-диаризацию!
- Описывай ТОЛЬКО что ВИДНО в кадре
- Определяй тип плана (Кр./Ср./Общ./Деталь)

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
