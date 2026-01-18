import { createServiceRoleClient } from '@/lib/supabase/server';
import { updateChunkStatus } from '@/lib/supabase/chunk-status';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseGeminiResponse, parseAlternativeFormat } from '@/lib/parseGeminiResponse';
import { validateTimecodeSequence } from '@/lib/timecode-validator';
import { timecodeToSeconds } from '@/lib/video-chunking';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';
import { getReplicatePool } from '@/lib/replicate-pool';
import { type ParsedScene } from '@/types';
// Новые промпты v2 — упрощённые, чёткие
import { createChunkPromptV2, createChunkPromptV3Json, formatCharacterRegistryForPrompt, createOpeningPromptAIFirst } from '@/lib/prompts-v2';
import { type MergedScene } from '@/lib/credits-detector';
// Legacy imports для fallback
import { createSimpleChunkPrompt, createPromptWithFFmpegScenes } from '@/lib/gemini-prompt-simple';
import { matchGeminiToFFmpeg, filterFFmpegScenesForChunk, scenesToBoundaries, validateMatching, type FFmpegScene } from '@/lib/scene-matcher';
// Накопительный реестр персонажей
import { formatRegistryForPrompt, type CharacterRegistry } from '@/lib/character-registry';
import { normalizeSceneSpeakers } from '@/lib/dialogue-speaker-normalizer';

const AI_MODEL = 'google/gemini-3-pro';

// УДАЛЕНО: extractCharactersFromScenes
// Причина: "Память персонажей" между чанками вызывала propagation ошибок
// Если модель ошибочно называла кого-то "ЛЮБОЧКА" вместо "ГАЛЯ",
// это имя добавлялось в knownCharacters и распространялось на ВСЕ последующие чанки.
// 
// Теперь каждый чанк анализируется НЕЗАВИСИМО - модель сама определяет
// имена персонажей из титров в видео.

const MAX_PREDICTION_ATTEMPTS = 5; // Увеличено с 3 до 5 для лучшей надежности

function tryParseJsonArray(text: string): any[] | null {
  const trimmed = (text || '').trim();

  // fenced json
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      // fall through
    }
  }

  // raw array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      // ignore
    }
  }

  return null;
}

function normalizeDialogueText(dialogues: string): string {
  if (!dialogues) return '';
  let out = dialogues.replace(/\s*\((ЗК|ГЗ|ГЗК)\)\b/g, ' $1');
  out = out.replace(/\(([А-ЯЁ]{2,})\)/g, '$1');
  return out.trim();
}

// 5 minutes timeout per chunk
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Parse request body at the top level so we can access in catch block
  let videoId: string | undefined;
  let chunkIndex: number | undefined;
  
  try {
    const body = await request.json();
    videoId = body.videoId;
    chunkIndex = body.chunkIndex;
    const chunkStorageUrl = body.chunkStorageUrl;
    const startTimecode = body.startTimecode;
    const endTimecode = body.endTimecode;
    const filmMetadata = body.filmMetadata;

    if (!videoId || chunkIndex === undefined || !chunkStorageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, chunkIndex, chunkStorageUrl' },
        { status: 400 }
      );
    }

    // После проверки - гарантированно number
    const currentChunkIndex: number = chunkIndex;

    console.log(`🎬 Processing chunk ${currentChunkIndex} for video ${videoId}`);
    console.log(`📹 Chunk: ${startTimecode} - ${endTimecode}`);
    console.log(`📹 Chunk storage URL: ${chunkStorageUrl.substring(0, 100)}...`);
    
    // Test if URL is accessible
    try {
      const testResponse = await fetch(chunkStorageUrl, { method: 'HEAD' });
      console.log(`✅ Chunk URL is accessible: ${testResponse.ok} (status: ${testResponse.status})`);
      if (!testResponse.ok) {
        console.warn(`⚠️  Chunk URL returned non-200 status. This may cause issues with the AI request.`);
      }
    } catch (testError) {
      console.error(`❌ Chunk URL is NOT accessible:`, testError);
    }

    const supabase = createServiceRoleClient();

    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json, user_id')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    const chunkProgress = video.chunk_progress_json;
    if (!chunkProgress || !chunkProgress.chunks[chunkIndex]) {
      throw new Error('Chunk progress not found');
    }

    const totalChunks: number = chunkProgress.totalChunks || chunkProgress.chunks.length;

    // Update chunk status to processing (ATOMIC - no race condition)
    await updateChunkStatus(videoId, chunkIndex, 'processing');

    // ═══════════════════════════════════════════════════════════════
    // РЕЖИМ v2: Merged Scenes + Упрощённые промпты
    // ═══════════════════════════════════════════════════════════════
    // 
    // НОВОЕ: Заставка и финальные титры объединены в ОДИН план
    // Промпты упрощены в 3 раза — без мусора, только суть
    // ═══════════════════════════════════════════════════════════════
    
    console.log(`\n🎬 РЕЖИМ v2: Merged Scenes + Упрощённые промпты`);
    console.log(`📹 Чанк ${chunkIndex}: ${startTimecode} - ${endTimecode}`);
    
    // Получаем merged scenes (заставка/титры объединены)
    const allMergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    const allDetectedScenes: FFmpegScene[] = chunkProgress.detectedScenes || [];
    const useMergedScenes = allMergedScenes.length > 0;
    const useFFmpegScenes = allDetectedScenes.length > 0;
    
    // ═══════════════════════════════════════════════════════════════
    // ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ (ПРИОРИТЕТ!) + НАКОПИТЕЛЬНЫЙ РЕЕСТР
    // ═══════════════════════════════════════════════════════════════
    const scriptData = chunkProgress.scriptData || null;
    const characterRegistry: CharacterRegistry | null = chunkProgress.characterRegistry || null;
    let registryBlock = '';
    let characterList: Array<{ name: string; gender?: string; actor?: string }> = [];
    
    // ПРИОРИТЕТ: Персонажи из сценария (если загружен)
    if (scriptData && scriptData.characters && scriptData.characters.length > 0) {
      console.log(`📋 СЦЕНАРИЙ: ${scriptData.characters.length} персонажей загружено`);
      const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      console.log(`   🌟 Главные: ${mainChars.map((c: any) => c.name).join(', ')}`);
      
      // Формируем список персонажей из сценария
      characterList = scriptData.characters.map((c: any) => ({
        name: c.name,
        gender: c.gender,
        actor: undefined, // В сценарии нет информации об актёрах
      }));
      
      // Формируем блок для промпта
      const lines: string[] = [];
      lines.push('═══════════════════════════════════════════════════════════════');
      lines.push('📋 ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ — ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ!');
      lines.push('═══════════════════════════════════════════════════════════════');
      
      // Главные персонажи
      const mainCharacters = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
      if (mainCharacters.length > 0) {
        lines.push('🌟 ГЛАВНЫЕ ПЕРСОНАЖИ:');
        for (const char of mainCharacters.slice(0, 12)) {
          const genderIcon = char.gender === 'female' ? '♀' : char.gender === 'male' ? '♂' : '';
          lines.push(`   • ${char.name} ${genderIcon} (${char.dialogueCount} реплик)`);
        }
      }
      
      // Второстепенные
      const secondary = scriptData.characters.filter((c: any) => c.dialogueCount >= 2 && c.dialogueCount < 5);
      if (secondary.length > 0) {
        lines.push('👤 ВТОРОСТЕПЕННЫЕ:');
        lines.push(`   ${secondary.slice(0, 15).map((c: any) => c.name).join(', ')}`);
      }
      
      lines.push('');
      lines.push('⚠️ КРИТИЧЕСКИ ВАЖНО:');
      lines.push('   ❌ НЕ пиши "ЖЕНЩИНА", "ДЕВУШКА", "МУЖЧИНА", "ПАРЕНЬ"');
      lines.push('   ✅ ИСПОЛЬЗУЙ имена из списка выше!');
      lines.push('═══════════════════════════════════════════════════════════════');
      
      registryBlock = lines.join('\n');
      
    } else if (characterRegistry && characterRegistry.characters.length > 0) {
      // Fallback: накопительный реестр (если нет сценария)
      console.log(`🎭 РЕЕСТР: ${characterRegistry.characters.length} известных персонажей`);
      console.log(`   → ${characterRegistry.characters.map(c => c.name).join(', ')}`);
      registryBlock = formatRegistryForPrompt(characterRegistry);
      characterList = characterRegistry.characters;
    } else {
      console.log(`🎭 РЕЕСТР пуст — первый чанк или нет персонажей/сценария`);
    }
    
    let prompt: string;
    let chunkScenes: MergedScene[] = [];
    let chunkFFmpegScenes: FFmpegScene[] = []; // Для совместимости с matching
    let expectedBoundaries: Array<{ start_timecode: string; end_timecode: string }> = [];
    
    // Фильтруем сцены для текущего чанка
    const chunkStartSeconds = timecodeToSeconds(startTimecode);
    const chunkEndSeconds = timecodeToSeconds(endTimecode);
    
    if (useMergedScenes) {
      // НОВЫЙ РЕЖИМ: используем merged scenes (заставка/титры объединены)
      chunkScenes = allMergedScenes.filter(s => 
        s.start_timestamp >= chunkStartSeconds - 1 && 
        s.start_timestamp < chunkEndSeconds
      );
      
      console.log(`📐 Merged scenes: ${chunkScenes.length} планов в этом чанке`);
      
      // Проверяем типы сцен
      const openingCredits = chunkScenes.filter(s => s.type === 'opening_credits');
      const closingCredits = chunkScenes.find(s => s.type === 'closing_credits');
      const regularScenes = chunkScenes.filter(s => s.type === 'regular');
      
      if (openingCredits.length > 0) {
        console.log(`   🎬 Включает ЗАСТАВКУ (${openingCredits.length} планов: логотип + заставка)`);
      }
      if (closingCredits) {
        console.log(`   🎬 Включает ФИНАЛЬНЫЕ ТИТРЫ (${closingCredits.originalScenesCount} сцен → 1 план)`);
      }
      console.log(`   📊 Обычных планов: ${regularScenes.length}`);
      
      // Формируем реестр персонажей для промпта
      const charRegistry = formatCharacterRegistryForPrompt(characterList);
      
      // ═══════════════════════════════════════════════════════════════
      // SMART MERGE режим: FFmpeg даёт склейки, Gemini объединяет заставку
      // Gemini получает ВСЕ склейки и САМ решает какие объединить
      // Это работает для ЛЮБОГО чанка, не только первого!
      // ═══════════════════════════════════════════════════════════════
      
      console.log(`\n🧠 SMART MERGE MODE: FFmpeg склейки + Gemini объединение`);
      console.log(`   📐 Склеек от FFmpeg: ${chunkScenes.length}`);
      console.log(`   🎯 Gemini объединит заставку/логотип/титры если увидит`);
      
      // Gemini получает ВСЕ FFmpeg склейки и сам решает что объединять
      prompt = createChunkPromptV3Json(chunkScenes, chunkIndex, totalChunks, charRegistry);
      console.log(`📝 Smart Merge промпт (${prompt.length} символов)`);
      
      // SMART MERGE: используем таймкоды GEMINI напрямую (он может объединять!)
      // НЕ используем matching с FFmpeg — Gemini вернёт свои таймкоды
      expectedBoundaries = [];
      chunkFFmpegScenes = []; // Пустой! Чтобы код пошёл в fallback ветку
      
    } else if (useFFmpegScenes) {
      // FALLBACK: старый режим с FFmpeg scenes
      console.log(`⚠️ Fallback: используем старый режим с FFmpeg scenes`);
      chunkFFmpegScenes = filterFFmpegScenesForChunk(allDetectedScenes, startTimecode, endTimecode);
      console.log(`📐 FFmpeg: ${chunkFFmpegScenes.length} сцен в этом чанке`);
      
      const sceneBoundaries = scenesToBoundaries(chunkFFmpegScenes);
      prompt = createPromptWithFFmpegScenes(sceneBoundaries, chunkIndex, totalChunks, registryBlock);
      console.log(`📝 Промпт с FFmpeg таймкодами (${sceneBoundaries.length} планов)`);
      expectedBoundaries = sceneBoundaries;
    } else {
      // Fallback: AI сам определяет планы
      console.log(`⚠️ Нет сцен для чанка, AI определит планы сам`);
      prompt = createSimpleChunkPrompt(chunkIndex, startTimecode, endTimecode, totalChunks, registryBlock);
      console.log(`📝 Простой промпт (AI определит планы самостоятельно)`);
    }

    // Get Replicate client from pool with least load (with rate limiting)
    const pool = getReplicatePool();
    const { client: replicate, keyIndex, release } = await pool.getLeastLoadedClient();

    // Start Replicate prediction with retries for transient errors (E6716)
    let completedPrediction: Awaited<ReturnType<typeof pollPrediction>> | null = null;

    try {
      for (let attempt = 1; attempt <= MAX_PREDICTION_ATTEMPTS; attempt++) {
        try {
          console.log(`🚀 Starting Replicate prediction for chunk ${chunkIndex} using key #${keyIndex} (attempt ${attempt}/${MAX_PREDICTION_ATTEMPTS})...`);
          const prediction = await createPredictionWithRetry(
            replicate,
            AI_MODEL,
            {
              videos: [chunkStorageUrl],
              prompt,
            }
          );

          console.log(`⏳ Polling prediction ${prediction.id} for chunk ${chunkIndex}...`);
          completedPrediction = await pollPrediction(replicate, prediction.id);

          if (completedPrediction.status === 'failed') {
            throw new Error(`Replicate prediction failed: ${completedPrediction.error}`);
          }

          // Success, exit retry loop
          break;
        } catch (predictionError) {
          const message = predictionError instanceof Error ? predictionError.message : String(predictionError);
          const isE6716 = message.includes('E6716') || message.toLowerCase().includes('timeout starting prediction');
          const isE004 = message.includes('E004') || message.includes('Service is temporarily unavailable');
          const isTemporaryError = isE6716 || isE004;

          if (isTemporaryError && attempt < MAX_PREDICTION_ATTEMPTS) {
            // Exponential backoff для временных ошибок: 5s, 20s, 45s, 80s
            const exponentialBackoff = Math.pow(attempt, 2) * 5000;
            const backoffMs = Math.min(exponentialBackoff, 90000); // Max 90s
            const errorCode = isE004 ? 'E004' : 'E6716';
            console.warn(`⚠️  Chunk ${chunkIndex} ${errorCode} (temporary error) on attempt ${attempt}. Retrying in ${backoffMs}ms (exponential backoff)...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }

          throw predictionError;
        }
      }
    } finally {
      // Always release the client back to the pool
      release();
    }

    if (!completedPrediction) {
      throw new Error('Replicate prediction did not complete after retries');
    }

    const output = completedPrediction.output;
    // Model output may be an array of strings, join them
    const aiResponse = Array.isArray(output) ? output.join('') : String(output);
    console.log(`✅ Chunk ${chunkIndex} AI response received (${aiResponse.length} chars)`);
    
    // Check for empty response BEFORE parsing
    if (aiResponse.length === 0 || aiResponse.trim().length === 0) {
      console.error(`❌ EMPTY RESPONSE from AI for chunk ${chunkIndex}!`);
      console.error(`🔍 Prediction ID: ${completedPrediction.id}`);
      console.error(`🔍 Prediction status: ${completedPrediction.status}`);
      console.error(`🔍 Raw output:`, JSON.stringify(output));
      
      // Mark chunk as failed and throw error to trigger retry at higher level
      chunkProgress.chunks[chunkIndex].status = 'failed';
      chunkProgress.chunks[chunkIndex].error = 'Empty response from AI';
      await supabase
        .from('videos')
        .update({ chunk_progress_json: chunkProgress })
        .eq('id', videoId);
      
      throw new Error(`Empty response from AI for chunk ${chunkIndex}. This needs manual retry.`);
    }
    
    // Log first 500 chars of response for debugging
    console.log(`📝 AI Response preview:`, aiResponse.substring(0, 500));
    console.log(`📝 AI Response end:`, aiResponse.substring(Math.max(0, aiResponse.length - 500)));

    // ═══════════════════════════════════════════════════════════════
    // ПАРСИНГ ОТВЕТА - ГИБРИДНЫЙ РЕЖИМ
    // Парсим AI, затем matching с FFmpeg таймкодами
    // ═══════════════════════════════════════════════════════════════
    
    console.log(`\n📝 Парсинг ответа AI`);
    // Production parsing strategy:
    // 1) Prefer strict JSON array (our prompt asks for it)
    // 2) Fallback to markdown parsers for resilience
    const parsedJsonArray = tryParseJsonArray(aiResponse);
    let geminiScenes: ParsedScene[] = [];
    let geminiContentOnly: Array<{ plan_type: string; description: string; dialogues: string }> = [];

    if (Array.isArray(parsedJsonArray)) {
      // Two formats supported:
      // A) legacy JSON with start/end
      // B) content-only JSON (no start/end) in correct order (preferred)
      const hasStartEnd = parsedJsonArray.some((o: any) => o && (o.start || o.end));
      if (hasStartEnd) {
        geminiScenes = parseGeminiResponse(aiResponse);
      } else {
        geminiContentOnly = parsedJsonArray.map((o: any) => ({
          plan_type: String(o.plan_type || o.shot_type || '').trim(),
          description: String(o.content_summary || o.visual_description || o.description || '').trim(),
          dialogues: normalizeDialogueText(String(o.dialogue || o.dialogues || '').trim()),
        }));
      }
    }

    if (geminiScenes.length === 0 && geminiContentOnly.length === 0) {
      geminiScenes = parseGeminiResponse(aiResponse);
      if (geminiScenes.length === 0) {
        console.log(`⚠️ Основной парсер не нашёл планов, пробуем альтернативный формат...`);
        geminiScenes = parseAlternativeFormat(aiResponse);
      }
    }

    const geminiCount = geminiContentOnly.length > 0 ? geminiContentOnly.length : geminiScenes.length;
    if (geminiCount === 0) {
      console.warn(`⚠️ Не найдено планов в чанке ${chunkIndex}`);
      console.warn(`🔍 AI response preview:`, aiResponse.substring(0, 1000));
    } else {
      console.log(`✅ AI нашёл ${geminiCount} планов`);
    }

    console.log(`📊 Parsed ${geminiCount} scenes from chunk ${chunkIndex}`);

    // ═══════════════════════════════════════════════════════════════
    // RETRY: Дозапрос недостающих или пустых планов
    // ═══════════════════════════════════════════════════════════════
    
    const missingThreshold = 0.8; // Если описано меньше 80% планов - дозапрос
    
    // Функция для дозапроса (используется дважды)
    const requestMissingScenes = async (scenesToRequest: MergedScene[], reason: string) => {
      if (scenesToRequest.length === 0) return;
      
      console.log(`📝 Дозапрос (${reason}): ${scenesToRequest.length} планов`);
      
      try {
        const charRegistry = formatCharacterRegistryForPrompt(characterList);
        const missingPrompt = createChunkPromptV3Json(scenesToRequest, currentChunkIndex, totalChunks, charRegistry);
        
        const { client: replicate2, keyIndex: keyIndex2, release: release2 } = await pool.getLeastLoadedClient();
        
        console.log(`🚀 Starting retry prediction using key #${keyIndex2}...`);
        const retryPrediction = await createPredictionWithRetry(
          replicate2,
          AI_MODEL,
          {
            videos: [chunkStorageUrl],
            prompt: missingPrompt,
          }
        );
        
        console.log(`⏳ Polling retry prediction ${retryPrediction.id}...`);
        const retryCompleted = await pollPrediction(replicate2, retryPrediction.id);
        release2();
        
        if (retryCompleted.status === 'succeeded' && retryCompleted.output) {
          const retryResponse = Array.isArray(retryCompleted.output) 
            ? retryCompleted.output.join('') 
            : String(retryCompleted.output);
          
          console.log(`✅ Retry response received (${retryResponse.length} chars)`);
          
          let additionalScenes = parseGeminiResponse(retryResponse);
          if (additionalScenes.length === 0) {
            additionalScenes = parseAlternativeFormat(retryResponse);
          }
          
          if (additionalScenes.length > 0) {
            console.log(`✅ Дозапрос добавил ${additionalScenes.length} планов`);
            
            // Мерджим с существующими: заменяем пустые на новые
            for (const newScene of additionalScenes) {
              const existingIndex = geminiScenes.findIndex(
                s => s.start_timecode === newScene.start_timecode
              );
              
              if (existingIndex >= 0) {
                // Заменяем только если новое описание лучше
                const existing = geminiScenes[existingIndex];
                if ((!existing.description || existing.description.length < 10) && 
                    newScene.description && newScene.description.length > 10) {
                  geminiScenes[existingIndex] = newScene;
                  console.log(`   🔄 Заменил план ${newScene.start_timecode}`);
                }
              } else {
                // Добавляем новый
                geminiScenes.push(newScene);
              }
            }
            console.log(`📊 Итого: ${geminiScenes.length} планов`);
          } else {
            console.warn(`⚠️ Дозапрос не вернул дополнительных планов`);
          }
        } else {
          console.warn(`⚠️ Retry prediction failed: ${retryCompleted.error}`);
        }
      } catch (retryError) {
        console.warn(`⚠️ Retry request failed:`, retryError);
      }
    };
    
    if (chunkFFmpegScenes.length > 0 && (geminiScenes.length > 0 || geminiContentOnly.length > 0)) {
      // 1️⃣ Проверка: количество планов
      const coverage = geminiCount / chunkFFmpegScenes.length;
      
      if (coverage < missingThreshold) {
        console.log(`\n🔄 ДОЗАПРОС #1: AI описал ${geminiScenes.length}/${chunkFFmpegScenes.length} планов (${Math.round(coverage * 100)}%)`);
        
        const lastDescribedTimecode = geminiScenes[geminiScenes.length - 1]?.start_timecode;
        const lastDescribedSeconds = lastDescribedTimecode ? timecodeToSeconds(lastDescribedTimecode) : 0;
        
        const missingScenes = chunkScenes.filter(s => s.start_timestamp > lastDescribedSeconds + 1);
        await requestMissingScenes(missingScenes, 'недостающие');
      }
      
      // 2️⃣ Проверка: пустые описания
      const emptyDescriptions = geminiContentOnly.length > 0
        ? geminiContentOnly.filter(s => !s.description || s.description.length < 5)
        : geminiScenes.filter(s => !s.description || s.description.length < 5);
      
      if (emptyDescriptions.length > 3) {
        console.log(`\n🔄 ДОЗАПРОС #2: ${emptyDescriptions.length} планов с пустым описанием`);
        
        // Находим соответствующие MergedScenes для пустых описаний
        const emptyTimecodes = new Set(geminiScenes.filter(s => !s.description || s.description.length < 5).map(s => s.start_timecode));
        const scenesToRetry = chunkScenes.filter(s => emptyTimecodes.has(s.start_timecode));
        
        await requestMissingScenes(scenesToRetry, 'пустые описания');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // MATCHING: FFmpeg таймкоды + AI содержание
    // ═══════════════════════════════════════════════════════════════
    
    let parsedScenes: ParsedScene[];
    let validationPassed = true;
    let validationWarnings: string[] = [];
    
    if (expectedBoundaries.length > 0 && (geminiScenes.length > 0 || geminiContentOnly.length > 0)) {
      // Новый режим: таймкоды ЖЁСТКО фиксированы (FFmpeg), AI даёт только контент.
      // Даже если AI ошибся в таймкодах, мы "приклеиваем" контент к ожидаемым интервалам.
      console.log(`\n🔒 Fixed-timecode mode: expected ${expectedBoundaries.length} plans, AI returned ${geminiCount}`);

      // Preferred: content-only array length must match N and we zip by index.
      if (geminiContentOnly.length === expectedBoundaries.length) {
        parsedScenes = expectedBoundaries.map((b, idx) => {
          const g = geminiContentOnly[idx];
          return {
            timecode: `${b.start_timecode} - ${b.end_timecode}`,
            start_timecode: b.start_timecode,
            end_timecode: b.end_timecode,
            plan_type: g.plan_type || 'Ср.',
            description: g.description || '',
            dialogues: g.dialogues || 'Музыка',
          };
        });
      } else {
        // Legacy: match by exact start/end keys if model returned them
        const byKey = new Map<string, ParsedScene>();
        for (const s of geminiScenes) {
          const key = `${s.start_timecode}|${s.end_timecode}`;
          if (!byKey.has(key)) byKey.set(key, s);
        }

        parsedScenes = expectedBoundaries.map(b => {
          const key = `${b.start_timecode}|${b.end_timecode}`;
          const match = byKey.get(key);
          return {
            timecode: `${b.start_timecode} - ${b.end_timecode}`,
            start_timecode: b.start_timecode,
            end_timecode: b.end_timecode,
            plan_type: match?.plan_type || 'Ср.',
            description: match?.description || '',
            dialogues: match?.dialogues || 'Музыка',
          };
        });

        const matchedCount = expectedBoundaries.filter(b => byKey.has(`${b.start_timecode}|${b.end_timecode}`)).length;
        if (matchedCount < Math.floor(expectedBoundaries.length * 0.7)) {
          validationWarnings.push(`⚠️ Низкое совпадение по таймкодам: совпало ${matchedCount}/${expectedBoundaries.length}. Вероятно, AI всё ещё возвращает start/end не по списку.`);
        }
      }
      
      // ═══════════════════════════════════════════════════════════════
      // ВАЛИДАЦИЯ: кол-во FFmpeg интервалов == кол-ву планов
      // ═══════════════════════════════════════════════════════════════
      const expectedCount = expectedBoundaries.length;
      const actualCount = parsedScenes.length;
      const countDiff = Math.abs(expectedCount - actualCount);
      const tolerance = Math.max(3, Math.floor(expectedCount * 0.1)); // 10% или минимум 3
      
      if (countDiff > tolerance) {
        validationPassed = false;
        validationWarnings.push(
          `⚠️ НЕСООТВЕТСТВИЕ: FFmpeg=${expectedCount} планов, AI описал ${actualCount} (разница: ${countDiff})`
        );
        console.warn(`\n${'⚠️'.repeat(20)}`);
        console.warn(`VALIDATION FAILED: Expected ${expectedCount} scenes, got ${actualCount}`);
        console.warn(`Difference: ${countDiff} (tolerance: ${tolerance})`);
        console.warn(`${'⚠️'.repeat(20)}\n`);
      } else {
        console.log(`✅ VALIDATION: FFmpeg=${expectedCount}, AI=${actualCount} (OK, diff=${countDiff})`);
      }
      
      console.log(`✅ Matching завершён: ${parsedScenes.length} сцен с точными таймкодами`);
    } else if (chunkFFmpegScenes.length > 0 && geminiScenes.length > 0) {
      // Старый режим: matching FFmpeg + AI по ближайшему таймкоду
      console.log(`\n🔗 Matching (legacy): ${chunkFFmpegScenes.length} FFmpeg сцен ↔ ${geminiScenes.length} AI описаний`);
      
      const matchResult = matchGeminiToFFmpeg(geminiScenes, chunkFFmpegScenes, 2.0);
      parsedScenes = matchResult.matched;
      
      const matchWarnings = validateMatching(matchResult);
      if (matchWarnings.length > 0) {
        matchWarnings.forEach(w => console.warn(w));
      }
    } else {
      // Fallback: используем AI сцены напрямую (фильтруем по диапазону чанка)
      console.log(`\n📊 Fallback: используем AI таймкоды напрямую`);
      
      const chunkStartSeconds = timecodeToSeconds(startTimecode);
      const chunkEndSeconds = timecodeToSeconds(endTimecode);
      
      console.log(`📊 Chunk range: ${startTimecode} (${chunkStartSeconds}s) - ${endTimecode} (${chunkEndSeconds}s)`);
      
      // Filter scenes to only include those within this chunk's time range
      const validScenes: ParsedScene[] = [];
      const filteredOut: ParsedScene[] = [];
      
      for (const scene of geminiScenes) {
        const sceneStartSeconds = timecodeToSeconds(scene.start_timecode);
        
        // Scene is valid if it starts within chunk range (with 1s tolerance for overlap)
        const isWithinRange = sceneStartSeconds >= (chunkStartSeconds - 1.0) && sceneStartSeconds < chunkEndSeconds;
        
        if (isWithinRange) {
          validScenes.push(scene);
        } else {
          console.warn(`⚠️ Scene ${scene.start_timecode} is OUTSIDE chunk range. Dropping.`);
          filteredOut.push(scene);
        }
      }
      
      if (filteredOut.length > 0) {
        console.warn(`⚠️  Filtered out ${filteredOut.length} scenes outside chunk range`);
      } else {
        console.log(`✅ All ${geminiScenes.length} scenes are within chunk range`);
      }
      
      parsedScenes = validScenes;
    }

    // ПРИМЕЧАНИЕ: Whisper отключён! AI сам слышит и транскрибирует диалоги.
    console.log(`🎤 Whisper ОТКЛЮЧЁН - AI сам слышит диалоги`);
    
    // ───────────────────────────────────────────────────────────────
    // Post-processing: normalize unknown speakers to role labels
    // Example: "НЕИЗВЕСТНАЯ\nОй!" + "Клиентка морщится..." → "КЛИЕНТКА\nОй!"
    // ───────────────────────────────────────────────────────────────
    parsedScenes = parsedScenes.map(normalizeSceneSpeakers);

    // ОТКЛЮЧЕНО: Извлечение персонажей
    // Причина: вызывало распространение ошибок между чанками

    // Validate timecode sequence
    console.log('\n🔍 Validating timecode sequence...');
    const validation = validateTimecodeSequence(parsedScenes);
    
    if (!validation.isValid) {
      console.warn(`⚠️ Timecode validation found ${validation.gaps.length} gaps and ${validation.overlaps.length} overlaps`);
      
      // Log first 5 issues for debugging
      validation.warnings.slice(0, 5).forEach(w => console.warn(w));
      if (validation.warnings.length > 5) {
        console.warn(`   ... and ${validation.warnings.length - 5} more warnings`);
      }
      
      // Calculate total lost time
      const totalLostFrames = validation.gaps.reduce((sum, g) => sum + g.gapDuration, 0);
      const totalLostSeconds = totalLostFrames / 24; // Assuming 24fps
      console.warn(`⚠️ Total lost time: ${totalLostFrames} frames (~${totalLostSeconds.toFixed(1)} seconds)`);
    } else {
      console.log('✅ Timecode validation passed - no gaps or overlaps!');
    }

    // Get sheet ID from chunk progress
    const sheetId = chunkProgress.sheetId;
    if (!sheetId) {
      throw new Error('Sheet ID not found in chunk progress');
    }

    // Verify that the sheet actually exists in database (prevent foreign key errors)
    const { data: existingSheet, error: sheetCheckError } = await supabase
      .from('montage_sheets')
      .select('id')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetCheckError || !existingSheet) {
      console.error(`❌ Sheet ${sheetId} not found in database! Possibly deleted or from duplicate initialization.`);
      throw new Error(`Sheet ${sheetId} does not exist. Video may have been processed by duplicate request.`);
    }

    console.log(`✅ Sheet ${sheetId} exists, proceeding with entry insertion`);

    // Determine the last assigned plan/order numbers to keep numbering continuous
    const { data: lastEntry, error: lastEntryError } = await supabase
      .from('montage_entries')
      .select('plan_number, order_index')
      .eq('sheet_id', sheetId)
      .order('plan_number', { ascending: false })
      .limit(1);
    
    if (lastEntryError) {
      console.error('Error fetching last plan number:', lastEntryError);
      throw new Error('Failed to fetch last plan number');
    }
    
    const lastPlanNumber = lastEntry?.[0]?.plan_number ?? 0;
    const lastOrderIndex = lastEntry?.[0]?.order_index ?? -1;

    // Insert parsed scenes into database
    const entriesToInsert = parsedScenes.map((scene, index) => ({
      sheet_id: sheetId,
      plan_number: lastPlanNumber + index + 1,
      order_index: lastOrderIndex + index + 1,
      start_timecode: scene.start_timecode,
      end_timecode: scene.end_timecode,
      plan_type: scene.plan_type || '',
      description: scene.description || '',
      dialogues: scene.dialogues || '',
    }));

    if (entriesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('montage_entries')
        .insert(entriesToInsert);

      if (insertError) {
        // Check if it's a duplicate key error (from parallel processing)
        if (insertError.code === '23505') {
          console.warn(`⚠️  Duplicate entries detected for chunk ${chunkIndex} (parallel processing), ignoring...`);
          // Don't throw error - this chunk was already processed by another request
        } else {
          console.error(`Error inserting entries for chunk ${chunkIndex}:`, insertError);
          throw new Error(`Failed to insert montage entries for chunk ${chunkIndex}`);
        }
      }
    }

    // Update chunk status to completed (ATOMIC - no race condition)
    await updateChunkStatus(videoId, chunkIndex, 'completed');

    console.log(`✅ Chunk ${chunkIndex} completed: ${parsedScenes.length} scenes saved`);

    // Получаем актуальное количество завершённых чанков
    const { data: updatedVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const updatedProgress = updatedVideo?.chunk_progress_json;

    return NextResponse.json({
      success: true,
      chunkIndex,
      scenesCount: parsedScenes.length,
      completedChunks: updatedProgress?.completedChunks || 0,
      totalChunks: updatedProgress?.totalChunks || totalChunks,
      validation: {
        passed: validationPassed,
        warnings: validationWarnings,
        expectedCount: chunkFFmpegScenes.length,
        actualCount: parsedScenes.length,
      },
    });

  } catch (error) {
    console.error('Error processing chunk:', error);
    
    // Update chunk status to failed (ATOMIC - no race condition)
    if (videoId && chunkIndex !== undefined) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await updateChunkStatus(videoId, chunkIndex, 'failed', errorMessage);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
