/**
 * Process Chunk V4 — с PySceneDetect таймкодами
 * 
 * Отличия от v3:
 * - Использует таймкоды от PySceneDetect (более точные)
 * - Промпты v4
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { updateChunkStatus } from '@/lib/supabase/chunk-status';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { timecodeToSeconds } from '@/lib/video-chunking';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';
import { getReplicatePool } from '@/lib/replicate-pool';
import { type ParsedScene } from '@/types';
import { type MergedScene } from '@/lib/credits-detector';
import { createChunkPromptV4, formatCharactersForPromptV4, parseResponseV4 } from '@/lib/prompts-v4';
import { transcribeAudioWithWords, extractAudioFromVideo, formatWordsForPlan, type WhisperWord } from '@/lib/whisper-transcription';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
// CharacterTracker убран — работаем только с персонажами из сценария

const AI_MODEL = 'google/gemini-3-pro';
const MAX_PREDICTION_ATTEMPTS = 5;

// Helper: seconds to timecode HH:MM:SS:FF
function secondsToTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 25);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

/**
 * Словарь коротких форм русских имён
 * ПОЛНОЕ → [КОРОТКИЕ]
 * Используется для:
 * 1. Добавления коротких форм в список известных персонажей
 * 2. Замены полных имён на короткие в финальном выводе
 */
const SHORT_NAMES_MAP: Record<string, string[]> = {
  // Женские имена — все варианты
  'ГАЛИНА': ['ГАЛЯ', 'ГАЛОЧКА'],
  'ТАТЬЯНА': ['ТАНЯ', 'ТАНЮША'],
  'СВЕТЛАНА': ['СВЕТА', 'СВЕТИК', 'СВЕТОЧКА'],
  'ЕЛЕНА': ['ЛЕНА', 'ЛЕНОЧКА'],
  'ВАЛЕНТИНА': ['ВАЛЯ', 'ВАЛЮША'],
  'НАДЕЖДА': ['НАДЯ', 'НАДЮША'],
  'МАРИЯ': ['МАША', 'МАШЕНЬКА'],
  'ЕКАТЕРИНА': ['КАТЯ', 'КАТЮША'],
  'АНАСТАСИЯ': ['НАСТЯ', 'НАСТЕНЬКА'],
  'ОЛЬГА': ['ОЛЯ', 'ОЛЕНЬКА'],
  'НАТАЛЬЯ': ['НАТАША', 'НАТУЛЯ'],
  'ЛЮДМИЛА': ['ЛЮДА', 'МИЛА', 'ЛЮДАСЯ'],
  'ИРИНА': ['ИРА', 'ИРОЧКА'],
  'ЕВГЕНИЯ': ['ЖЕНЯ', 'ЖЕНЕЧКА'],
  'ВЕРА': ['ВЕРА', 'ВЕРОЧКА'],
  'ЛЮБОВЬ': ['ЛЮБА', 'ЛЮБАША'],
  'ДАРЬЯ': ['ДАША', 'ДАШЕНЬКА'],
  'ПОЛИНА': ['ПОЛЯ', 'ПОЛЮША'],
  'ЮЛИЯ': ['ЮЛЯ', 'ЮЛЕЧКА'],
  'ЗИНАИДА': ['ЗИНА', 'ЗИНОЧКА'],
  'ЛАРИСА': ['ЛАРА', 'ЛАРИСКА'],
  'ВАРВАРА': ['ВАРЯ', 'ВАРЕНЬКА'],
  'ТАМАРА': ['ТОМА', 'ТОМОЧКА'],
  'АЛЕКСАНДРА': ['ШУРА', 'ШУРОЧКА', 'САША'],
  'СЮЗАННА': ['СЮЗАННА'],
  // Мужские имена — все варианты
  'АЛЕКСАНДР': ['САША', 'ШУРА'],
  'ДМИТРИЙ': ['ДИМА', 'ДИМОЧКА'],
  'МИХАИЛ': ['МИША', 'МИШЕНЬКА'],
  'ЕВГЕНИЙ': ['ЖЕНЯ', 'ЖЕНЕЧКА'],
  'НИКОЛАЙ': ['КОЛЯ', 'КОЛЮНЯ'],
  'ВЛАДИМИР': ['ВОВА', 'ВОЛОДЯ', 'ВОВЧИК'],
  'СЕРГЕЙ': ['СЕРЁЖА', 'СЕРЁЖЕНЬКА'],
  'АНДРЕЙ': ['АНДРЮША', 'АНДРЮШЕНЬКА'],
  'АЛЕКСЕЙ': ['ЛЁША', 'АЛЁША', 'ЛЁШЕНЬКА'],
  'ИВАН': ['ВАНЯ', 'ВАНЮША'],
  'ПЁТР': ['ПЕТЯ', 'ПЕТЕНЬКА'],
  'ВИКТОР': ['ВИТЯ', 'ВИТЕНЬКА'],
  'ЮРИЙ': ['ЮРА', 'ЮРОЧКА'],
  'БОРИС': ['БОРЯ', 'БОРЕНЬКА'],
  'ПАВЕЛ': ['ПАША', 'ПАШЕНЬКА'],
  'ВАСИЛИЙ': ['ВАСЯ', 'ВАСЕНЬКА'],
  // Специфичные имена (сами по себе короткие или не сокращаются)
  'ИОСИФ': ['ИОСИФ'], // Не сокращается в контексте
  'ЮСЕФ': ['ЮСЕФ'],   // Арабское имя — не сокращается
  'БЭЛЛА': ['БЭЛЛА'],
  'ТОМА': ['ТОМА'],
  'ЛЮДАСЯ': ['ЛЮДАСЯ'],
};

/**
 * Словарь ПОЛНОЕ → ПРЕДПОЧТИТЕЛЬНАЯ КОРОТКАЯ ФОРМА
 * Используется для замены полных имён на короткие в финальном выводе
 * 
 * ВАЖНО: Короткие формы более естественны для диалогов
 */
const FULL_TO_SHORT: Record<string, string> = {
  // Женские имена
  'ГАЛИНА': 'ГАЛЯ',
  'ТАТЬЯНА': 'ТАНЯ',
  'СВЕТЛАНА': 'СВЕТА',
  'ЕЛЕНА': 'ЛЕНА',
  'ВАЛЕНТИНА': 'ВАЛЯ',
  'НАДЕЖДА': 'НАДЯ',
  'МАРИЯ': 'МАША',
  'ЕКАТЕРИНА': 'КАТЯ',
  'ЛЮДМИЛА': 'ЛЮДАСЯ',
  'ЗИНАИДА': 'ЗИНА',
  'ЛАРИСА': 'ЛАРА',
  'ВАРВАРА': 'ВАРЯ',
  'ТАМАРА': 'ТОМА',
  'ОЛЬГА': 'ОЛЯ',
  'ИРИНА': 'ИРА',
  'АННА': 'АНЯ',
  'НАТАЛЬЯ': 'НАТАША',
  'АЛЕКСАНДРА': 'ШУРА',
  'ЕВГЕНИЯ': 'ЖЕНЯ',
  'ЮЛИЯ': 'ЮЛЯ',
  'ДАРЬЯ': 'ДАША',
  'ПОЛИНА': 'ПОЛЯ',
  'АНАСТАСИЯ': 'НАСТЯ',
  // Мужские имена
  'ВЛАДИМИР': 'ВОВА',
  'ВИКТОР': 'ВИТЯ',
  'АЛЕКСАНДР': 'САША',
  'ДМИТРИЙ': 'ДИМА',
  'МИХАИЛ': 'МИША',
  'НИКОЛАЙ': 'КОЛЯ',
  'СЕРГЕЙ': 'СЕРЁЖА',
  'АНДРЕЙ': 'АНДРЮША',
  'АЛЕКСЕЙ': 'ЛЁША',
  'ИВАН': 'ВАНЯ',
  'ПЁТР': 'ПЕТЯ',
  'ЮРИЙ': 'ЮРА',
  'БОРИС': 'БОРЯ',
  'ПАВЕЛ': 'ПАША',
  'ВАСИЛИЙ': 'ВАСЯ',
  'ЕВГЕНИЙ': 'ЖЕНЯ',
  // Специфичные имена (не сокращаются)
  'ИОСИФ': 'ИОСИФ',
  'ЮСЕФ': 'ЮСЕФ',
  'БЭЛЛА': 'БЭЛЛА',
  'ШУРОЧКА': 'ШУРОЧКА',
  'ЛЮДАСЯ': 'ЛЮДАСЯ',
  'ТОМА': 'ТОМА',
  'СЮЗАННА': 'СЮЗАННА',
};

/**
 * Выдуманные звуковые эффекты, которые нужно заменить на "Музыка"
 * Whisper иногда выдаёт такие, но в реальных листах их нет
 */
const FAKE_SOUND_EFFECTS = [
  '[Шаги]',
  '[Звук шагов]',
  '[Шум одежды]',
  '[Вздох]',
  '[Звук воды]',
  '[Пауза]',
  '[Фоновая музыка ресторана]',
  '[Шум ресторана]',
  '[Шум]',
  '[Тишина]',
  '[Молчание]',
  '[Звук]',
  '[Фон]',
  '[Фоновые звуки]',
  '[Шорох]',
  '[Скрип]',
  '[Стук]',
  '[Звонок]',
  '[Музыка]', // Уже есть, но не в скобках
  'ИНТРИГУЮЩАЯ МУЗЫКА',
  'УСМЕХАЕТСЯ',
];

/**
 * Извлекает короткие формы русских имён
 */
function extractShortNames(fullName: string): string[] {
  const upper = fullName.toUpperCase().trim();
  return SHORT_NAMES_MAP[upper] || [];
}

/**
 * Заменяет полные имена на короткие формы в тексте
 * ВАЖНО: \b не работает с кириллицей, используем явные границы
 */
function replaceFullNamesWithShort(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const [full, short] of Object.entries(FULL_TO_SHORT)) {
    // Кириллическая граница слова: начало строки, пробел, перенос, или конец строки
    // Заменяем UPPERCASE (ГАЛИНА → ГАЛЯ)
    const regexUpper = new RegExp(`(^|[\\s\\n])${full}([\\s\\n]|$)`, 'g');
    result = result.replace(regexUpper, `$1${short}$2`);
    
    // Заменяем Capitalized (Галина → Галя)
    const fullCapitalized = full.charAt(0) + full.slice(1).toLowerCase();
    const shortCapitalized = short.charAt(0) + short.slice(1).toLowerCase();
    const regexCapitalized = new RegExp(`(^|[\\s\\n])${fullCapitalized}([\\s\\n]|$)`, 'g');
    result = result.replace(regexCapitalized, `$1${shortCapitalized}$2`);
    
    // Заменяем lowercase (галина → галя)
    const fullLower = full.toLowerCase();
    const shortLower = short.toLowerCase();
    const regexLower = new RegExp(`(^|[\\s\\n])${fullLower}([\\s\\n]|$)`, 'g');
    result = result.replace(regexLower, `$1${shortLower}$2`);
  }
  return result;
}

/**
 * Очищает диалоги от выдуманных звуковых эффектов
 * [Шаги] → Музыка, [Вздох] → (удаляется), и т.д.
 */
function cleanFakeSoundEffects(dialogues: string): string {
  let cleaned = dialogues.trim();
  
  // Если весь диалог — это один фейковый эффект, заменяем на "Музыка"
  for (const effect of FAKE_SOUND_EFFECTS) {
    if (cleaned === effect || cleaned.toLowerCase() === effect.toLowerCase()) {
      return 'Музыка';
    }
  }
  
  // Удаляем фейковые эффекты из середины текста
  for (const effect of FAKE_SOUND_EFFECTS) {
    const regex = new RegExp(effect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, '').trim();
  }
  
  // Если после очистки осталась пустая строка — ставим "Музыка"
  if (cleaned.length === 0 || cleaned === '...' || cleaned === '—') {
    return 'Музыка';
  }
  
  return cleaned;
}

// Helper: Объединяет планы заставки в один план (как в реальном монтажном листе)
interface SceneForMerge {
  timecode: string;
  start_timecode: string;
  end_timecode: string;
  plan_type: string;
  description: string;
  dialogues: string;
}

/**
 * Нормализует тип плана к стандартному формату
 * "Кр. План" → "Кр.", "Ср. План" → "Ср." и т.д.
 */
function normalizePlanType(planType: string): string {
  if (!planType) return 'Ср.';
  
  let normalized = planType.trim();
  
  // Убираем " План" в конце
  normalized = normalized.replace(/\s*План\s*$/i, '');
  
  // Стандартизируем форматы
  const lowerType = normalized.toLowerCase();
  
  // "Нарезка" → стандартный тип (обычно для заставок)
  if (lowerType.includes('нарезка')) {
    if (lowerType.includes('ндп')) return 'Ср. НДП';
    return 'Ср. НДП'; // Нарезка обычно с титрами
  }
  
  // НДП варианты
  if (lowerType.includes('ндп')) {
    if (lowerType.includes('кр')) return 'Кр. НДП';
    if (lowerType.includes('ср')) return 'Ср. НДП';
    return 'НДП';
  }
  
  // Основные типы
  if (lowerType.startsWith('кр')) return 'Кр.';
  if (lowerType.startsWith('ср')) return 'Ср.';
  if (lowerType.startsWith('общ')) return 'Общ.';
  if (lowerType.startsWith('дет')) return 'Деталь';
  
  // Если уже короткая форма с точкой — оставляем
  if (normalized.endsWith('.') && normalized.length <= 5) {
    return normalized;
  }
  
  return normalized || 'Ср.';
}

/**
 * Проверяет, является ли сцена логотипом (короткий план с "логотип" в описании)
 */
function isLogoScene(scene: SceneForMerge): boolean {
  const desc = scene.description.toLowerCase();
  return desc.includes('логотип') && !desc.includes('заставка');
}

/**
 * Проверяет, является ли сцена частью заставки/интро
 * Критерии: "заставка", "титр:", или сцена до 01:10:00 с "Музыка" в диалогах
 */
function isCreditsScene(scene: SceneForMerge, isEarlyInVideo: boolean = false): boolean {
  const desc = scene.description.toLowerCase();
  const dialogues = scene.dialogues.toLowerCase();
  
  // Явные признаки заставки
  if (desc.includes('заставка') || desc.includes('титр:') || desc.includes('название:')) {
    return !desc.includes('логотип');
  }
  
  // Для первых ~70 секунд видео: если "Музыка" и нет реальных диалогов
  if (isEarlyInVideo) {
    const hasRealDialogue = dialogues.length > 0 && 
                            !dialogues.includes('музыка') && 
                            dialogues.match(/[а-яё]{10,}/i); // минимум 10 букв подряд = реальная реплика
    if (!hasRealDialogue && (dialogues.includes('музыка') || dialogues === '')) {
      return true;
    }
  }
  
  return false;
}

function mergeCreditsPlans(scenes: SceneForMerge[]): SceneForMerge {
  if (scenes.length === 0) {
    throw new Error('No scenes to merge');
  }
  
  if (scenes.length === 1) {
    return scenes[0];
  }
  
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  
  // Собираем все описания в одно
  const descriptions: string[] = [];
  const titlesSet = new Set<string>();
  
  for (const scene of scenes) {
    // Извлекаем титры отдельно
    const titleMatches = scene.description.match(/Титр:\s*[^\n]+/gi) || [];
    for (const title of titleMatches) {
      titlesSet.add(title.trim());
    }
    
    // Извлекаем название если есть
    const nameMatch = scene.description.match(/Название:\s*[^\n]+/gi);
    if (nameMatch) {
      for (const name of nameMatch) {
        titlesSet.add(name.trim());
      }
    }
    
    // Основное описание без титров
    let desc = scene.description
      .replace(/Титр:\s*[^\n]+/gi, '')
      .replace(/Название:\s*[^\n]+/gi, '')
      .replace(/Заставка\.\s*/gi, '')
      .replace(/Логотип\.\s*/gi, '')
      .trim();
    
    if (desc && !descriptions.includes(desc)) {
      descriptions.push(desc);
    }
  }
  
  // Определяем тип: Логотип или Заставка
  const isLogo = first.description.toLowerCase().includes('логотип');
  const planType = isLogo ? 'НДП' : 'Ср. НДП';
  const prefix = isLogo ? 'Логотип.' : 'Заставка.';
  
  // Формируем финальное описание — все на одной строке через пробел
  let finalDescription = prefix;
  if (descriptions.length > 0) {
    finalDescription += ' ' + descriptions.join(' ');
  }
  
  // Добавляем все титры (каждый с новой строки)
  if (titlesSet.size > 0) {
    finalDescription += ' ' + Array.from(titlesSet).join(' ');
  }
  
  return {
    timecode: `${first.start_timecode} - ${last.end_timecode}`,
    start_timecode: first.start_timecode,
    end_timecode: last.end_timecode,
    plan_type: planType,
    description: finalDescription.trim(),
    dialogues: 'Музыка',
  };
}

/**
 * 🔍 Детектирует проблемы качества в ответе Gemini:
 * - "Залипание" (много одинаковых описаний подряд)
 * - Слишком много пустых/placeholder описаний
 * - Слишком короткие описания
 * 
 * @returns объект с флагом needsRetry и списком проблем
 */
interface QualityCheckResult {
  needsRetry: boolean;
  score: number; // 0-100
  issues: string[];
}

function detectQualityIssues(scenes: SceneForMerge[]): QualityCheckResult {
  const issues: string[] = [];
  let score = 100;
  
  if (scenes.length === 0) {
    return { needsRetry: false, score: 100, issues: [] };
  }
  
  // 1. Детектируем "залипание" — много одинаковых описаний подряд
  const descriptionCounts = new Map<string, number>();
  let maxConsecutiveSame = 1;
  let currentConsecutive = 1;
  let prevDesc = '';
  
  for (const scene of scenes) {
    const desc = scene.description.toLowerCase().trim();
    descriptionCounts.set(desc, (descriptionCounts.get(desc) || 0) + 1);
    
    if (desc === prevDesc && desc.length > 0) {
      currentConsecutive++;
      maxConsecutiveSame = Math.max(maxConsecutiveSame, currentConsecutive);
    } else {
      currentConsecutive = 1;
    }
    prevDesc = desc;
  }
  
  // Если 5+ одинаковых описаний подряд — критическая ошибка
  if (maxConsecutiveSame >= 5) {
    issues.push(`${maxConsecutiveSame} одинаковых описаний подряд (залипание)`);
    score -= 40;
  } else if (maxConsecutiveSame >= 3) {
    issues.push(`${maxConsecutiveSame} одинаковых описаний подряд`);
    score -= 15;
  }
  
  // 2. Проверяем самое частое описание
  const mostCommonDesc = [...descriptionCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0];
  
  if (mostCommonDesc) {
    const [desc, count] = mostCommonDesc;
    const ratio = count / scenes.length;
    
    // Если одно описание занимает >30% всех сцен (и это не заставка)
    if (ratio > 0.3 && !desc.includes('заставка') && !desc.includes('логотип')) {
      issues.push(`Описание "${desc.substring(0, 30)}..." повторяется ${count}x (${Math.round(ratio * 100)}%)`);
      score -= Math.round(ratio * 50);
    }
  }
  
  // 3. Проверяем пустые/placeholder описания
  const placeholderCount = scenes.filter(s => 
    !s.description || 
    s.description === '[Требует описания]' ||
    s.description.length < 5
  ).length;
  
  const placeholderRatio = placeholderCount / scenes.length;
  if (placeholderRatio > 0.2) {
    issues.push(`${placeholderCount} пустых описаний (${Math.round(placeholderRatio * 100)}%)`);
    score -= Math.round(placeholderRatio * 40);
  }
  
  // 4. Проверяем очень короткие описания (< 10 символов)
  const shortCount = scenes.filter(s => 
    s.description && 
    s.description.length > 0 && 
    s.description.length < 10 &&
    !s.description.toLowerCase().includes('музыка')
  ).length;
  
  const shortRatio = shortCount / scenes.length;
  if (shortRatio > 0.3) {
    issues.push(`${shortCount} слишком коротких описаний (${Math.round(shortRatio * 100)}%)`);
    score -= Math.round(shortRatio * 25);
  }
  
  // 5. Проверяем "в кадре" повторения (частый паттерн залипания)
  const inFrameCount = scenes.filter(s => 
    s.description.toLowerCase().match(/^[а-яё]+\s+в кадре\.?$/i)
  ).length;
  
  if (inFrameCount >= 5) {
    issues.push(`${inFrameCount} описаний вида "X в кадре" (паттерн залипания)`);
    score -= 30;
  }
  
  // Финальный score
  score = Math.max(0, Math.min(100, score));
  
  // Нужен retry если score < 50
  const needsRetry = score < 50;
  
  return { needsRetry, score, issues };
}

// 5 minutes timeout
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let videoId: string | undefined;
  let chunkIndex: number | undefined;
  
  try {
    const body = await request.json();
    videoId = body.videoId;
    chunkIndex = body.chunkIndex;
    const chunkStorageUrl = body.chunkStorageUrl;
    const startTimecode = body.startTimecode;
    const endTimecode = body.endTimecode;

    if (!videoId || chunkIndex === undefined || !chunkStorageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 V4 CHUNK ${chunkIndex} (PySceneDetect): ${startTimecode} - ${endTimecode}`);
    console.log(`${'═'.repeat(60)}`);

    const supabase = createServiceRoleClient();

    // Get video data
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

    // Update status
    await updateChunkStatus(videoId, chunkIndex, 'processing');

    // Get scenes for this chunk (from PySceneDetect)
    const allMergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    const chunkStartSeconds = timecodeToSeconds(startTimecode);
    const chunkEndSeconds = timecodeToSeconds(endTimecode);
    
    const chunkScenes = allMergedScenes.filter(s => 
      s.start_timestamp >= chunkStartSeconds - 1 && 
      s.start_timestamp < chunkEndSeconds
    );
    
    console.log(`📐 PySceneDetect scenes in chunk: ${chunkScenes.length}`);

    // Prepare character registry (только из сценария)
    let characterRegistry = '';
    const scriptData = chunkProgress.scriptData;
    
    if (scriptData?.characters?.length > 0) {
      characterRegistry = formatCharactersForPromptV4(scriptData.characters);
      console.log(`📋 Characters from script: ${scriptData.characters.length}`);
    }

    // Build scene boundaries for prompt
    const sceneBoundaries = chunkScenes.map(s => ({
      start_timecode: s.start_timecode,
      end_timecode: s.end_timecode,
    }));

    // Create V4 prompt
    const isFirstChunk = chunkIndex === 0;
    const isLastChunk = chunkIndex === totalChunks - 1;
    
    const prompt = createChunkPromptV4(
      sceneBoundaries,
      chunkIndex,
      totalChunks,
      isFirstChunk,
      isLastChunk,
      characterRegistry
    );
    
    console.log(`📝 V4 Prompt: ${prompt.length} chars`);

    // Get Replicate client
    const pool = getReplicatePool();
    const { client: replicate, keyIndex, release } = await pool.getLeastLoadedClient();

    let completedPrediction: Awaited<ReturnType<typeof pollPrediction>> | null = null;

    try {
      for (let attempt = 1; attempt <= MAX_PREDICTION_ATTEMPTS; attempt++) {
        try {
          console.log(`🚀 Prediction attempt ${attempt}/${MAX_PREDICTION_ATTEMPTS} (key #${keyIndex})`);
          
          const prediction = await createPredictionWithRetry(
            replicate,
            AI_MODEL,
            {
              videos: [chunkStorageUrl],
              prompt,
            }
          );

          console.log(`⏳ Polling ${prediction.id}...`);
          completedPrediction = await pollPrediction(replicate, prediction.id);

          if (completedPrediction.status === 'failed') {
            throw new Error(`Prediction failed: ${completedPrediction.error}`);
          }

          break;
        } catch (predictionError) {
          const message = predictionError instanceof Error ? predictionError.message : String(predictionError);
          const isTemporary = message.includes('E6716') || message.includes('E004') || message.includes('timeout');

          if (isTemporary && attempt < MAX_PREDICTION_ATTEMPTS) {
            const backoffMs = Math.min(Math.pow(attempt, 2) * 5000, 90000);
            console.warn(`⚠️ Temporary error, retry in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }

          throw predictionError;
        }
      }
    } finally {
      release();
    }

    if (!completedPrediction) {
      throw new Error('Prediction did not complete');
    }

    const output = completedPrediction.output;
    const aiResponse = Array.isArray(output) ? output.join('') : String(output);
    console.log(`✅ AI response: ${aiResponse.length} chars`);
    
    // Log first 800 chars for debugging
    console.log(`\n🔍 AI Response preview:\n${'─'.repeat(60)}`);
    console.log(aiResponse.substring(0, 800));
    console.log(`${'─'.repeat(60)}\n`);
    
    if (aiResponse.length === 0) {
      throw new Error('Empty response from AI');
    }

    // Parse V4 response (markdown format)
    console.log(`\n📝 Parsing V4 markdown response...`);
    let parsedScenes = parseResponseV4(aiResponse);
    
    console.log(`📊 Parsed ${parsedScenes.length} scenes from markdown`);
    
    // If markdown parsing failed, try fallback
    if (parsedScenes.length === 0) {
      console.warn(`⚠️ Markdown parsing failed, trying fallback...`);
      const { parseGeminiResponse } = await import('@/lib/parseGeminiResponse');
      const fallbackScenes = parseGeminiResponse(aiResponse);
      
      parsedScenes = fallbackScenes.map(s => ({
        start_timecode: s.start_timecode,
        end_timecode: s.end_timecode,
        plan_type: s.plan_type || 'Ср.',
        description: s.description || '',
        dialogues: s.dialogues || 'Музыка',
      }));
      
      console.log(`📊 Fallback parsed ${parsedScenes.length} scenes`);
    }

    // Match AI content to PySceneDetect timecodes
    let finalScenes: ParsedScene[];
    
    if (sceneBoundaries.length > 0 && parsedScenes.length > 0) {
      if (parsedScenes.length === sceneBoundaries.length) {
        // Идеальный случай: количество совпадает
        console.log(`✅ Perfect match: ${parsedScenes.length} AI = ${sceneBoundaries.length} PySceneDetect`);
        finalScenes = sceneBoundaries.map((b, idx) => ({
          timecode: `${b.start_timecode} - ${b.end_timecode}`,
          start_timecode: b.start_timecode,
          end_timecode: b.end_timecode,
          plan_type: parsedScenes[idx]?.plan_type || 'Ср.',
          description: parsedScenes[idx]?.description || '',
          dialogues: parsedScenes[idx]?.dialogues || 'Музыка',
        }));
      } else {
        // Количество не совпадает — УМНОЕ СОПОСТАВЛЕНИЕ
        console.warn(`⚠️ Mismatch: ${parsedScenes.length} AI vs ${sceneBoundaries.length} PySceneDetect`);
        
        // Создаём карту AI сцен по таймкодам для быстрого поиска
        const aiSceneMap = new Map<string, typeof parsedScenes[0]>();
        for (const scene of parsedScenes) {
          aiSceneMap.set(scene.start_timecode, scene);
        }
        
        // Для каждой PySceneDetect сцены ищем соответствующую AI сцену
        finalScenes = sceneBoundaries.map((b) => {
          // Точное совпадение по start_timecode
          let aiScene = aiSceneMap.get(b.start_timecode);
          
          // Если не нашли — ищем ближайшую (в пределах 2 секунд)
          if (!aiScene) {
            const targetStart = timecodeToSeconds(b.start_timecode);
            let closestScene: typeof parsedScenes[0] | null = null;
            let closestDiff = 2; // максимум 2 секунды разницы
            
            for (const scene of parsedScenes) {
              const sceneStart = timecodeToSeconds(scene.start_timecode);
              const diff = Math.abs(sceneStart - targetStart);
              if (diff < closestDiff) {
                closestDiff = diff;
                closestScene = scene;
              }
            }
            
            if (closestScene) {
              aiScene = closestScene;
              // Удаляем использованную сцену чтобы не использовать повторно
              aiSceneMap.delete(closestScene.start_timecode);
            }
          } else {
            aiSceneMap.delete(b.start_timecode);
          }
          
          if (aiScene) {
            return {
              timecode: `${b.start_timecode} - ${b.end_timecode}`,
              start_timecode: b.start_timecode,
              end_timecode: b.end_timecode,
              plan_type: aiScene.plan_type || 'Ср.',
              description: aiScene.description || '',
              dialogues: aiScene.dialogues || 'Музыка',
            };
          } else {
            // ═══════════════════════════════════════════════════════════════
            // 🎬 НОВАЯ ЛОГИКА: Проверяем, попадает ли сцена ВНУТРЬ объединённого плана
            // Например: заставка 00:00:04 - 00:01:06 содержит 30 микро-склеек
            // Gemini описал их как ОДИН план — используем его данные!
            // ═══════════════════════════════════════════════════════════════
            const targetStart = timecodeToSeconds(b.start_timecode);
            let containingPlan: typeof parsedScenes[0] | null = null;
            
            for (const scene of parsedScenes) {
              const planStart = timecodeToSeconds(scene.start_timecode);
              const planEnd = timecodeToSeconds(scene.end_timecode);
              
              // Если наша сцена попадает ВНУТРЬ этого плана — это объединённый план
              if (targetStart >= planStart && targetStart < planEnd) {
                containingPlan = scene;
                break;
              }
            }
            
            if (containingPlan) {
              // Сцена внутри объединённого плана (заставка, титры и т.д.)
              // Возвращаем null — эта сцена будет пропущена, используется объединённый план
              return null; // Mark for filtering
            } else {
              // Действительно не нашли — создаём placeholder
            console.log(`   ⚠️ No AI match for ${b.start_timecode}, creating placeholder`);
            return {
              timecode: `${b.start_timecode} - ${b.end_timecode}`,
              start_timecode: b.start_timecode,
              end_timecode: b.end_timecode,
              plan_type: 'Ср.',
              description: '[Требует описания]',
              dialogues: 'Музыка',
            };
            }
          }
        });
        
        // Фильтруем null (сцены внутри объединённых планов) и добавляем объединённые планы
        const filteredScenes = finalScenes.filter((s): s is NonNullable<typeof s> => s !== null);
        
        // Добавляем объединённые планы Gemini (заставки и т.д.) которые покрывают несколько сцен
        const mergedPlans = parsedScenes.filter(p => {
          const planStart = timecodeToSeconds(p.start_timecode);
          const planEnd = timecodeToSeconds(p.end_timecode);
          const planDuration = planEnd - planStart;
          
          // Если план длится > 10 секунд, это вероятно объединённый план (заставка)
          return planDuration > 10;
        });
        
        // Объединяем: объединённые планы + отфильтрованные обычные сцены
        const allScenes = [
          ...mergedPlans.map(p => ({
            timecode: `${p.start_timecode} - ${p.end_timecode}`,
            start_timecode: p.start_timecode,
            end_timecode: p.end_timecode,
            plan_type: p.plan_type || 'Ср.',
            description: p.description || '',
            dialogues: p.dialogues || 'Музыка',
          })),
          ...filteredScenes.filter(s => {
            // Исключаем сцены которые уже покрыты объединёнными планами
            const sceneStart = timecodeToSeconds(s.start_timecode);
            return !mergedPlans.some(p => {
              const planStart = timecodeToSeconds(p.start_timecode);
              const planEnd = timecodeToSeconds(p.end_timecode);
              return sceneStart >= planStart && sceneStart < planEnd;
            });
          }),
        ];
        
        // Сортируем по времени
        finalScenes = allScenes.sort((a, b) => 
          timecodeToSeconds(a.start_timecode) - timecodeToSeconds(b.start_timecode)
        );
        
        const matched = finalScenes.filter(s => !s.description.includes('[Требует описания]')).length;
        console.log(`📊 Smart matching: ${matched}/${finalScenes.length} scenes (${sceneBoundaries.length} raw → ${finalScenes.length} with merges)`);
      }
    } else {
      finalScenes = parsedScenes.map(s => ({
        timecode: `${s.start_timecode} - ${s.end_timecode}`,
        start_timecode: s.start_timecode,
        end_timecode: s.end_timecode,
        plan_type: s.plan_type || 'Ср.',
        description: s.description || '',
        dialogues: s.dialogues || 'Музыка',
      }));
    }

    // Filter scenes within chunk range
    let validScenes = finalScenes.filter(scene => {
      const sceneStart = timecodeToSeconds(scene.start_timecode);
      return sceneStart >= (chunkStartSeconds - 1) && sceneStart < chunkEndSeconds;
    });

    console.log(`📊 Valid scenes in range: ${validScenes.length}`);

    // ═══════════════════════════════════════════════════════════════
    // 🔍 ПРОВЕРКА КАЧЕСТВА: Детектируем "залипание" Gemini
    // ═══════════════════════════════════════════════════════════════
    const qualityIssues = detectQualityIssues(validScenes);
    
    if (qualityIssues.needsRetry) {
      console.warn(`\n⚠️ QUALITY ISSUES DETECTED:`);
      for (const issue of qualityIssues.issues) {
        console.warn(`   ❌ ${issue}`);
      }
      console.warn(`   📊 Quality score: ${qualityIssues.score}/100`);
      
      // Возвращаем ошибку для retry на уровне orchestrator
      return NextResponse.json({
        success: false,
        needsRetry: true,
        chunkIndex,
        qualityScore: qualityIssues.score,
        issues: qualityIssues.issues,
        error: `Quality check failed: ${qualityIssues.issues.join('; ')}`,
      }, { status: 422 }); // 422 = Unprocessable Entity (качество плохое)
    }
    
    console.log(`✅ Quality check passed (score: ${qualityIssues.score}/100)`);

    // ═══════════════════════════════════════════════════════════════
    // 🎤 WHISPER ASR: Word-level timestamps для точных диалогов
    // ═══════════════════════════════════════════════════════════════
    let whisperWords: WhisperWord[] = [];
    const tempDir = '/tmp/whisper-v4';
    const tempVideoPath = path.join(tempDir, `chunk_${videoId}_${chunkIndex}.mp4`);
    const tempAudioPath = path.join(tempDir, `chunk_${videoId}_${chunkIndex}.mp3`);
    
    try {
      console.log(`\n🎤 WHISPER: Starting WORD-LEVEL transcription...`);
      
      // Ensure temp directory exists
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      
      // Download video chunk
      console.log(`📥 Downloading video chunk...`);
      const videoResponse = await fetch(chunkStorageUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`);
      }
      const videoBuffer = await videoResponse.arrayBuffer();
      writeFileSync(tempVideoPath, Buffer.from(videoBuffer));
      console.log(`✅ Video downloaded: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
      
      // Extract audio and transcribe with WORD-LEVEL timestamps
      await extractAudioFromVideo(tempVideoPath, tempAudioPath);
      const transcription = await transcribeAudioWithWords(tempAudioPath, 'ru');
      
      // Adjust word timecodes to absolute video time
      whisperWords = (transcription.words || []).map(w => ({
        start: w.start + chunkStartSeconds,
        end: w.end + chunkStartSeconds,
        word: w.word,
      }));
      
      console.log(`✅ Whisper: ${whisperWords.length} words found (word-level)`);
      
      // Log first 10 words for debugging
      if (whisperWords.length > 0) {
        console.log(`📝 Whisper words sample (first 10):`);
        const sample = whisperWords.slice(0, 10);
        const wordsPreview = sample.map(w => `"${w.word}"`).join(' ');
        const timeRange = `${secondsToTimecode(sample[0].start)} - ${secondsToTimecode(sample[sample.length-1].end)}`;
        console.log(`   ${timeRange}: ${wordsPreview}`);
      }
      
      // Merge: Gemini names + Whisper text (with smart speaker detection)
      if (whisperWords.length > 0) {
          console.log(`🔄 Merging: Gemini=КТО + Whisper=ЧТО (SMART SPEAKER v8)...`);
          
          // ═══════════════════════════════════════════════════════════════
          // 🎭 SMART SPEAKER v8: Gemini=КТО, Whisper=ЧТО
          // ═══════════════════════════════════════════════════════════════
        
        // Список известных персонажей — ДИНАМИЧЕСКИ из сценария
        const knownCharacters: string[] = [];
          // Маппинг персонажей с описаниями для визуального матчинга
          const characterDescriptions: Map<string, string> = new Map();
          // Маппинг профессий на имена
          const professionToName: Map<string, string> = new Map();
          
        if (scriptData?.characters?.length > 0) {
          for (const char of scriptData.characters) {
            if (char.name) {
                const upperName = char.name.toUpperCase();
                
              // Добавляем имя в верхнем регистре
                knownCharacters.push(upperName);
                
              // Добавляем также короткие формы (ГАЛИНА → ГАЛЯ)
              const shortForms = extractShortNames(char.name);
              for (const short of shortForms) {
                if (!knownCharacters.includes(short.toUpperCase())) {
                  knownCharacters.push(short.toUpperCase());
                }
              }
                
                // Сохраняем описание для визуального матчинга
                if (char.description) {
                  characterDescriptions.set(upperName, char.description.toLowerCase());
                  
                  // Извлекаем профессии из описания
                  const desc = char.description.toLowerCase();
                  if (desc.includes('косметолог') || desc.includes('массажист')) {
                    professionToName.set('КОСМЕТОЛОГ', upperName);
                  }
                  if (desc.includes('менеджер') || desc.includes('управляющ') || desc.includes('директор')) {
                    professionToName.set('МЕНЕДЖЕР', upperName);
                  }
                  if (desc.includes('официант')) {
                    professionToName.set('ОФИЦИАНТКА', upperName);
                  }
                  if (desc.includes('клиент')) {
                    if (!professionToName.has('КЛИЕНТКА')) {
                      professionToName.set('КЛИЕНТКА', upperName);
                    }
                  }
                }
              }
            }
          }
          console.log(`   📋 Known characters: ${knownCharacters.length}`);
          if (professionToName.size > 0) {
            console.log(`   🔄 Profession mapping: ${JSON.stringify(Object.fromEntries(professionToName))}`);
          }
        
        // Пассивные действия — персонаж скорее всего НЕ говорит
        const passiveActions = [
          'слушает', 'смотрит', 'стоит', 'сидит', 'лежит', 'ждёт', 'ждет', 
          'молчит', 'наблюдает', 'спит', 'дремлет', 'отдыхает'
        ];
        // Активные действия — персонаж скорее всего говорит
        const activeActions = [
          'говорит', 'отвечает', 'спрашивает', 'рассказывает', 'объясняет', 
          'кричит', 'шепчет', 'продолжает', 'обращается', 'жалуется',
          'возмущается', 'удивляется', 'реагирует', 'комментирует',
          'говорит в кадре', 'в кадре, говорит', 'разговаривает'
        ];
        
        // ═══════════════════════════════════════════════════════════════
        // 🎯 SMART SPEAKER v10 — УПРОЩЁННАЯ ВЕРСИЯ
        // ═══════════════════════════════════════════════════════════════
        // 
        // Всего 3 правила:
        // 1. Gemini видит спикера? → берём его
        // 2. Нет спикера, но есть речь? → lastSpeaker + ЗК
        // 3. Ничего нет? → НЕИЗВЕСТНЫЙ
        //
        // Персонажи ТОЛЬКО из сценария — не изобретаем новых!
        // ═══════════════════════════════════════════════════════════════
        
        let lastSpeaker: string | null = null;
        const GAP_TOLERANCE = 5.0; // секунд для наследования спикера
        
        validScenes = validScenes.map((scene, sceneIndex) => {
          const sceneStart = timecodeToSeconds(scene.start_timecode);
          const sceneEnd = timecodeToSeconds(scene.end_timecode);
          const description = scene.description || '';
          const descLower = description.toLowerCase();
          
          // Логотип/заставка — всегда "Музыка"
          if (descLower.includes('логотип') || descLower.includes('заставка')) {
            return { ...scene, dialogues: 'Музыка' };
          }
          
          // Whisper: какие слова попадают в этот план?
          const whisperText = formatWordsForPlan(whisperWords, sceneStart, sceneEnd);
          
          // Нет речи в плане
          if (!whisperText || whisperText.length === 0) {
            // Gemini думает что есть диалог? → оставляем
            if (scene.dialogues && scene.dialogues.toLowerCase() !== 'музыка') {
              return scene;
            }
            return { ...scene, dialogues: 'Музыка' };
          }
          
          // ═══════════════════════════════════════════════════════════════
          // ПРАВИЛО 0: Gemini указал НЕСКОЛЬКИХ спикеров? → НЕ ТРОГАЕМ!
          // ═══════════════════════════════════════════════════════════════
          const geminiDialogues = scene.dialogues || '';
          
          // Считаем количество спикеров в Gemini-ответе
          const speakerLines = geminiDialogues.split('\n').filter(line => {
            const trimmed = line.trim();
            // Строка с именем спикера: ГАЛЯ, БЭЛЛА ЗК, ИОСИФ и т.д.
            return /^[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,15}(\s*(ЗК|ГЗ))?$/.test(trimmed);
          });
          
          // Если Gemini уже правильно разметил несколько спикеров — оставляем как есть!
          if (speakerLines.length >= 2) {
            // Обновляем lastSpeaker для следующих сцен
            const lastSpeakerLine = speakerLines[speakerLines.length - 1];
            lastSpeaker = lastSpeakerLine.replace(/\s*(ЗК|ГЗ)\s*/g, '').trim();
            
            if (sceneIndex < 5) {
              console.log(`   📋 Multi-speaker scene preserved: ${speakerLines.length} speakers (${scene.start_timecode})`);
            }
            return scene; // Оставляем Gemini-разметку как есть
          }
          
          // ═══════════════════════════════════════════════════════════════
          // АНАЛИЗ ТРЕТЬЕГО ЛИЦА: о ком говорят? (делаем СНАЧАЛА!)
          // Если говорят "ты не Галя" или "где Галя?" — Галя НЕ говорит!
          // ═══════════════════════════════════════════════════════════════
          const excludedSpeakers: string[] = [];
          const speechLower = whisperText.toLowerCase();
          
          for (const char of knownCharacters) {
            const charLower = char.toLowerCase();
            // Паттерны третьего лица: "не Галя", "где Галя", "моя жена Галя", "это Галя?"
            const thirdPersonPatterns = [
              `не ${charLower}`,           // "ты не Галя"
              `где ${charLower}`,          // "где Галя?"
              `это ${charLower}`,          // "это Галя?"
              `жена ${charLower}`,         // "моя жена Галя"
              `муж ${charLower}`,          // "мой муж Юсеф"
              `ищу ${charLower}`,          // "ищу Галю"
              `${charLower} моя`,          // "Галя моя жена"
              `${charLower} мой`,          // "Юсеф мой муж"
              `позови ${charLower}`,       // "позови Галю"
              `найди ${charLower}`,        // "найди Галю"
            ];
            
            for (const pattern of thirdPersonPatterns) {
              if (speechLower.includes(pattern)) {
                excludedSpeakers.push(char);
                break;
              }
            }
          }
          
          // Логируем если исключили спикера
          if (excludedSpeakers.length > 0 && sceneIndex < 5) {
            console.log(`   🚫 Third-person exclusion: ${excludedSpeakers.join(', ')} (from speech)`);
          }
          
          // ═══════════════════════════════════════════════════════════════
          // ПРАВИЛО 1: Gemini видит спикера?
          // ═══════════════════════════════════════════════════════════════
          let speaker: string | null = null;
          
          // Извлекаем имя из диалога Gemini (формат: "ИМЯ\nтекст" или "ИМЯ ЗК\nтекст")
          const speakerMatch = geminiDialogues.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,15})(?:\s*ЗК|\s*ГЗ)?[\n\r]/);
          if (speakerMatch) {
            const candidateName = speakerMatch[1].trim().toUpperCase();
            // Проверяем: это персонаж из сценария и НЕ исключён?
            if (knownCharacters.some(c => c.toUpperCase() === candidateName) && 
                !excludedSpeakers.includes(candidateName)) {
              speaker = candidateName;
            }
          }
          
          // Альтернатива: "Имя говорит/отвечает" в описании (расширенные паттерны)
          if (!speaker) {
            // Паттерны активного говорения
            const speakingPatterns = [
              'говорит', 'отвечает', 'спрашивает', 'рассказывает', 'объясняет',
              'кричит', 'шепчет', 'обращается', 'жалуется', 'возмущается',
              'в кадре, говорит', 'говорит в кадре', 'в кадре говорит'
            ];
            const patternStr = speakingPatterns.join('|');
            
            for (const char of knownCharacters) {
              // Пропускаем исключённых
              if (excludedSpeakers.includes(char)) continue;
              
              // "Тома говорит" или "Тома в кадре, говорит"
              const pattern1 = new RegExp(`\\b${char}\\b[^.]{0,30}?(${patternStr})`, 'i');
              // "говорит Тома" (обратный порядок)
              const pattern2 = new RegExp(`(${patternStr})[^.]{0,10}?\\b${char}\\b`, 'i');
              
              if (pattern1.test(description) || pattern2.test(description)) {
                speaker = char;
                break;
              }
            }
          }
          
          // Если в описании есть "идет по салону" + имя → это не обязательно говорящий
          // Но если персонаж ЕДИНСТВЕННЫЙ в сцене, он скорее всего говорит
          if (!speaker) {
            // Исключаем тех, о ком говорят в третьем лице
            const charsInScene = knownCharacters.filter(c => 
              new RegExp(`\\b${c}\\b`, 'i').test(description) &&
              !excludedSpeakers.includes(c)
            );
            
            // Если 1 персонаж — он и говорит
            if (charsInScene.length === 1) {
              speaker = charsInScene[0];
            }
            // Если 2+ персонажа — ищем того, кто "активен" (говорит, отвечает)
            else if (charsInScene.length > 1) {
              for (const char of charsInScene) {
                // Персонаж с активным глаголом
                if (/\bговорит|\bотвечает|\bспрашивает/i.test(description.split(char)[1] || '')) {
                  speaker = char;
                  break;
                }
              }
              // Если никто не "говорит" явно — берём первого упомянутого
              if (!speaker) {
                speaker = charsInScene[0];
              }
            }
          }
          
          // Заменяем полное имя на короткое
          if (speaker) {
            const shortForm = FULL_TO_SHORT[speaker];
            if (shortForm) speaker = shortForm;
          }
          
          // ═══════════════════════════════════════════════════════════════
          // ПРАВИЛО 1.5: Первая сцена чанка — особый случай
          // ═══════════════════════════════════════════════════════════════
          if (!speaker && sceneIndex === 0) {
            // В первой сцене чанка нет lastSpeaker — ищем персонажа в описании
            const firstSceneChar = knownCharacters.find(c => 
              new RegExp(`\\b${c}\\b`, 'i').test(description)
            );
            if (firstSceneChar) {
              speaker = firstSceneChar;
              console.log(`   🎬 First scene speaker: ${speaker} (from description)`);
            }
          }
          
          // ═══════════════════════════════════════════════════════════════
          // ПРАВИЛО 2: Нет спикера? → наследуем lastSpeaker + ЗК
          // ═══════════════════════════════════════════════════════════════
          if (!speaker && lastSpeaker && sceneIndex > 0) {
            const prevScene = validScenes[sceneIndex - 1];
            const prevEnd = timecodeToSeconds(prevScene.end_timecode);
            const timeDiff = sceneStart - prevEnd;
            
            const cleanLastSpeaker = lastSpeaker.replace(/\s*ЗК\s*/g, '').trim();
            
            // Gap < 5 сек → тот же спикер (за кадром)
            if (timeDiff < GAP_TOLERANCE) {
              // Спикер виден в текущей сцене?
              const speakerVisible = new RegExp(`\\b${cleanLastSpeaker}\\b`, 'i').test(description);
              speaker = speakerVisible ? cleanLastSpeaker : `${cleanLastSpeaker} ЗК`;
              
              if (sceneIndex < 5) {
                console.log(`   🎤 ${speakerVisible ? 'Inherited' : 'Off-screen'}: ${speaker} (gap ${timeDiff.toFixed(1)}s)`);
              }
            }
          }
          
          // ═══════════════════════════════════════════════════════════════
          // ПРАВИЛО 3: Fallback — доверяем Gemini, минимум догадок
          // (excludedSpeakers уже рассчитан выше)
          // ═══════════════════════════════════════════════════════════════
          if (!speaker) {
            // Попытка 3a: персонаж упомянут в описании (Gemini его видит)
            // НО исключаем тех, о ком говорят в третьем лице!
            const anyChar = knownCharacters.find(c => 
              new RegExp(`\\b${c}\\b`, 'i').test(description) &&
              !excludedSpeakers.includes(c)
            );
            if (anyChar) {
              speaker = anyChar;
            }
            
            // Попытка 3b: наследуем от предыдущей сцены
            if (!speaker && lastSpeaker) {
              const cleanLast = lastSpeaker.replace(/\s*ЗК\s*/g, '').trim();
              // Проверяем что lastSpeaker не упомянут в третьем лице
              if (!excludedSpeakers.includes(cleanLast)) {
                speaker = `${cleanLast} ЗК`;
              }
            }
            
            // Попытка 3c: персонаж в описании (даже если говорит О другом)
            if (!speaker) {
              const anyCharInDesc = knownCharacters.find(c => 
                new RegExp(`\\b${c}\\b`, 'i').test(description)
              );
              if (anyCharInDesc) {
                speaker = anyCharInDesc;
              }
            }
            
            // Попытка 3d: берём главного персонажа по количеству реплик
            // НО исключаем того, о ком говорят!
            if (!speaker && scriptData?.characters?.length > 0) {
              // Сортируем по количеству реплик
              const sorted = [...scriptData.characters]
                .filter(c => !excludedSpeakers.includes(c.name?.toUpperCase() || ''))
                .sort((a, b) => (b.dialogueCount || 0) - (a.dialogueCount || 0));
              // Берём персонажа с наибольшим количеством реплик
              if (sorted[0]?.name) {
                speaker = sorted[0].name.toUpperCase();
                console.log(`   📊 Fallback to top speaker: ${speaker} (${sorted[0].dialogueCount} lines)`);
              }
            }
            
            // Крайний fallback — НЕИЗВЕСТНЫЙ (но теперь это редкость)
            if (!speaker) {
              speaker = 'НЕИЗВЕСТНЫЙ';
              console.log(`   ⚠️ Unknown speaker at ${scene.start_timecode}`);
            }
          }
          
          
          // Запоминаем спикера (без ЗК) для следующих сцен
          lastSpeaker = speaker.replace(/\s*ЗК\s*/g, '').trim();
          
          if (sceneIndex < 3) {
            console.log(`   🎯 ${speaker}: "${whisperText.slice(0, 40)}..." (${scene.start_timecode})`);
          }
          
          return {
            ...scene,
            dialogues: `${speaker}\n${whisperText}`,
          };
        });
        
        console.log(`✅ Smart Speaker v10: ${validScenes.length} scenes processed`);
      }
      
    } catch (whisperError) {
      console.warn(`⚠️ Whisper failed, using Gemini dialogues:`, whisperError instanceof Error ? whisperError.message : whisperError);
      // Continue with Gemini dialogues if Whisper fails
    } finally {
      // Cleanup temp files
      try {
        if (existsSync(tempVideoPath)) unlinkSync(tempVideoPath);
        if (existsSync(tempAudioPath)) unlinkSync(tempAudioPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 🎬 ПОСТ-ОБРАБОТКА (упрощённая)
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n📐 Post-processing...`);
    
    validScenes = validScenes.map(scene => {
      return {
        ...scene,
        // Заменяем полные имена на короткие (ГАЛИНА → ГАЛЯ)
        dialogues: replaceFullNamesWithShort(scene.dialogues),
        description: replaceFullNamesWithShort(scene.description),
        // Нормализуем тип плана
        plan_type: normalizePlanType(scene.plan_type),
      };
    });
    
    console.log(`   ✅ Names normalized, plan types fixed`);

    // Get sheet ID
    const sheetId = chunkProgress.sheetId;
    if (!sheetId) {
      throw new Error('Sheet ID not found');
    }

    // Verify sheet exists
    const { data: existingSheet, error: sheetCheckError } = await supabase
      .from('montage_sheets')
      .select('id')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetCheckError || !existingSheet) {
      throw new Error(`Sheet ${sheetId} does not exist`);
    }

    // Get last plan number
    const { data: lastEntry } = await supabase
      .from('montage_entries')
      .select('plan_number, order_index')
      .eq('sheet_id', sheetId)
      .order('plan_number', { ascending: false })
      .limit(1);
    
    const lastPlanNumber = lastEntry?.[0]?.plan_number ?? 0;
    const lastOrderIndex = lastEntry?.[0]?.order_index ?? -1;

    // Insert entries
    const entriesToInsert = validScenes.map((scene, index) => ({
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
      // Log first 3 entries
      console.log(`\n📋 Sample entries (first 3 of ${entriesToInsert.length}):`);
      console.log('─'.repeat(80));
      for (const entry of entriesToInsert.slice(0, 3)) {
        console.log(`#${entry.plan_number} | ${entry.start_timecode} - ${entry.end_timecode} | ${entry.plan_type}`);
        console.log(`   📝 ${entry.description.substring(0, 100)}${entry.description.length > 100 ? '...' : ''}`);
        console.log(`   💬 ${entry.dialogues.substring(0, 80)}${entry.dialogues.length > 80 ? '...' : ''}`);
      }
      console.log('─'.repeat(80));
      
      const { error: insertError } = await supabase
        .from('montage_entries')
        .insert(entriesToInsert);

      if (insertError) {
        if (insertError.code === '23505') {
          console.warn(`⚠️  Duplicate entries (parallel processing)`);
        } else {
          throw new Error(`Insert failed: ${insertError.message}`);
        }
      }
    }

    // Update chunk status
    await updateChunkStatus(videoId, chunkIndex, 'completed');

    console.log(`\n✅ V4 CHUNK ${chunkIndex} COMPLETE: ${validScenes.length} scenes saved`);

    // Get updated progress
    const { data: updatedVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const updatedProgress = updatedVideo?.chunk_progress_json;

    return NextResponse.json({
      success: true,
      chunkIndex,
      scenesCount: validScenes.length,
      completedChunks: updatedProgress?.completedChunks || 0,
      totalChunks: updatedProgress?.totalChunks || totalChunks,
      processingVersion: 'v4',
      sceneDetector: 'pyscenedetect',
    });

  } catch (error) {
    console.error('V4 Chunk Error:', error);
    
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

