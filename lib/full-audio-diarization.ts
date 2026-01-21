/**
 * Full Audio Diarization Module
 * 
 * Обрабатывает ВСЁ аудио фильма одним запросом к AssemblyAI
 * для получения стабильных Speaker ID на весь фильм.
 * 
 * Флоу:
 * 1. Извлечь аудио из видео (FFmpeg)
 * 2. Загрузить в Supabase Storage
 * 3. Отправить в AssemblyAI (один запрос)
 * 4. Получить words с Speaker ID (A, B, C...)
 * 5. Калибровать: Speaker → Персонаж (из первых сцен с Gemini)
 * 6. Сохранить маппинг для использования в чанках
 */

import { AssemblyAI, TranscriptWord } from 'assemblyai';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, unlinkSync, statSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Результат полной диаризации
 */
export interface FullDiarizationResult {
  words: DiarizedWordFull[];
  speakers: string[];
  speakerCount: number;
  totalDuration: number;  // секунды
  text: string;
}

/**
 * Слово с информацией о спикере (полная версия)
 */
export interface DiarizedWordFull {
  word: string;
  start: number;      // миллисекунды от начала фильма
  end: number;        // миллисекунды
  speaker: string;    // A, B, C...
  confidence: number;
}

/**
 * Маппинг Speaker → Character
 */
export interface SpeakerCharacterMapping {
  speakerId: string;
  characterName: string;
  confidence: number;
  calibrationTimecode: string;
}

/**
 * Полные данные диаризации для видео
 */
export interface VideoDiarizationData {
  videoId: string;
  result: FullDiarizationResult;
  speakerMapping: SpeakerCharacterMapping[];
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════

/**
 * Извлекает аудио из видео файла
 */
export async function extractFullAudio(
  videoPath: string,
  outputPath: string
): Promise<string> {
  console.log(`🎵 Extracting full audio from video...`);
  console.log(`   Input: ${videoPath}`);
  console.log(`   Output: ${outputPath}`);
  
  // Проверяем что видео существует
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  
  const videoSize = statSync(videoPath).size / (1024 * 1024);
  console.log(`   Video size: ${videoSize.toFixed(1)} MB`);
  
  // FFmpeg: извлекаем аудио в MP3
  const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ab 128k -ar 44100 "${outputPath}"`;
  
  try {
    console.log(`   Running FFmpeg...`);
    const { stderr } = await execAsync(ffmpegCmd, { maxBuffer: 50 * 1024 * 1024 });
    
    if (!existsSync(outputPath)) {
      throw new Error('FFmpeg did not create output file');
    }
    
    const audioSize = statSync(outputPath).size / (1024 * 1024);
    console.log(`   ✅ Audio extracted: ${audioSize.toFixed(1)} MB`);
    
    return outputPath;
  } catch (error) {
    console.error(`   ❌ FFmpeg error:`, error);
    throw error;
  }
}

/**
 * Выполняет полную диаризацию аудио через AssemblyAI
 * 
 * @param audioUrl - URL аудио файла (публичный)
 * @param language - язык (default: ru)
 * @param speakerHints - подсказки имён персонажей для word boost
 * @param maxSpeakers - максимальное количество спикеров
 */
export async function performFullDiarization(
  audioUrl: string,
  language: string = 'ru',
  speakerHints: string[] = [],
  maxSpeakers: number = 10
): Promise<FullDiarizationResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY not set');
  }
  
  const client = new AssemblyAI({ apiKey });
  
  console.log(`\n🎤 FULL DIARIZATION: Starting AssemblyAI transcription...`);
  console.log(`   URL: ${audioUrl.substring(0, 80)}...`);
  console.log(`   Language: ${language}`);
  console.log(`   Max speakers: ${maxSpeakers}`);
  console.log(`   Word boost: ${speakerHints.slice(0, 5).join(', ')}...`);
  console.log(`   ⏳ This may take several minutes for long videos...`);
  
  const startTime = Date.now();
  
  try {
    const transcript = await client.transcripts.transcribe({
      audio_url: audioUrl,
      speaker_labels: true,
      language_code: language,
      word_boost: speakerHints.slice(0, 20),
      boost_param: 'high',
      // УВЕЛИЧЕНО с 10 до 15 для лучшего различения всех голосов
      // Если в фильме больше персонажей, они могут быть объединены при меньшем значении
      speakers_expected: Math.min(maxSpeakers, 15),
      punctuate: true,
      format_text: true,
    });
    
    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI error: ${transcript.error}`);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`   ✅ Transcription completed in ${duration.toFixed(1)}s`);
    
    // Конвертируем слова
    const words: DiarizedWordFull[] = (transcript.words || []).map((w: TranscriptWord) => ({
      word: w.text || '',
      start: w.start,
      end: w.end,
      speaker: w.speaker || 'A',
      confidence: w.confidence,
    }));
    
    // Собираем уникальных спикеров
    const speakersSet = new Set<string>();
    for (const w of words) {
      speakersSet.add(w.speaker);
    }
    const speakers = Array.from(speakersSet).sort();
    
    const totalDuration = (transcript.audio_duration || 0) / 1000;
    
    console.log(`\n📊 DIARIZATION RESULTS:`);
    console.log(`   Total words: ${words.length}`);
    console.log(`   Speakers found: ${speakers.length} (${speakers.join(', ')})`);
    console.log(`   Audio duration: ${(totalDuration / 60).toFixed(1)} min`);
    console.log(`   Text length: ${(transcript.text || '').length} chars`);
    
    return {
      words,
      speakers,
      speakerCount: speakers.length,
      totalDuration,
      text: transcript.text || '',
    };
    
  } catch (error) {
    console.error(`   ❌ AssemblyAI error:`, error);
    throw error;
  }
}

/**
 * Получает слова конкретного спикера в заданном временном диапазоне
 */
export function getWordsForSpeakerInRange(
  words: DiarizedWordFull[],
  speaker: string,
  startMs: number,
  endMs: number
): DiarizedWordFull[] {
  return words.filter(w => 
    w.speaker === speaker &&
    w.start >= startMs &&
    w.end <= endMs
  );
}

/**
 * Получает все слова в заданном временном диапазоне
 */
export function getWordsInTimeRange(
  words: DiarizedWordFull[],
  startMs: number,
  endMs: number
): DiarizedWordFull[] {
  return words.filter(w => w.start >= startMs && w.end <= endMs);
}

/**
 * Находит доминантного спикера в временном диапазоне
 */
export function getDominantSpeaker(
  words: DiarizedWordFull[],
  startMs: number,
  endMs: number
): string | null {
  const rangeWords = getWordsInTimeRange(words, startMs, endMs);
  
  if (rangeWords.length === 0) return null;
  
  const speakerCounts: Record<string, number> = {};
  for (const w of rangeWords) {
    speakerCounts[w.speaker] = (speakerCounts[w.speaker] || 0) + 1;
  }
  
  const sorted = Object.entries(speakerCounts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

/**
 * Форматирует слова для отображения в плане
 */
export function formatWordsForDisplay(
  words: DiarizedWordFull[],
  startMs: number,
  endMs: number,
  speakerMapping: Record<string, string>
): string {
  const rangeWords = getWordsInTimeRange(words, startMs, endMs);
  
  if (rangeWords.length === 0) return '';
  
  // Группируем по спикерам
  const speakerTexts: Record<string, string[]> = {};
  let currentSpeaker = '';
  
  for (const w of rangeWords) {
    const speaker = speakerMapping[w.speaker] || w.speaker;
    if (speaker !== currentSpeaker) {
      currentSpeaker = speaker;
      if (!speakerTexts[speaker]) {
        speakerTexts[speaker] = [];
      }
    }
    speakerTexts[currentSpeaker].push(w.word);
  }
  
  // Форматируем
  const lines: string[] = [];
  for (const [speaker, words] of Object.entries(speakerTexts)) {
    lines.push(`${speaker}\n${words.join(' ')}`);
  }
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// КАЛИБРОВКА СПИКЕРОВ
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// УНИВЕРСАЛЬНЫЙ ПОДХОД: НЕТ ХАРДКОДА ИМЁН
// Имена берём КАК ЕСТЬ из сценария
// ═══════════════════════════════════════════════════════════════

// Простой маппинг: каждое имя из сценария маппится на себя
function buildVariantToCanonical(knownCharacters: string[]): Map<string, string> {
  const map = new Map<string, string>();
  
  // Просто добавляем все известные персонажи как есть
  for (const char of knownCharacters) {
    map.set(char, char);
  }
  
  return map;
}

/**
 * Калибрует маппинг Speaker → Character используя визуальные подсказки от Gemini
 * 
 * @param diarizationResult - результат полной диаризации
 * @param geminiScenes - первые сцены с визуальной идентификацией от Gemini
 * @param knownCharacters - список известных персонажей из сценария
 * @param timecodeToMs - функция конвертации таймкода в миллисекунды
 * @param _fullDiarizationWords - DEPRECATED, не используется
 * @param speakersToCalibrate - опционально: калибровать только этих спикеров
 */
export function calibrateSpeakerMapping(
  diarizationResult: FullDiarizationResult,
  geminiScenes: Array<{
    start_timecode: string;
    end_timecode: string;
    description: string;
    dialogues: string;
  }>,
  knownCharacters: string[],
  timecodeToMs: (tc: string) => number,
  _fullDiarizationWords?: unknown, // DEPRECATED
  speakersToCalibrate?: string[]   // Новый параметр: калибровать только этих спикеров
): SpeakerCharacterMapping[] {
  const mappings: SpeakerCharacterMapping[] = [];
  const assignedSpeakers = new Set<string>();
  const assignedCharacters = new Set<string>();
  
  // Строим маппинг вариантов имён
  const variantToCanonical = buildVariantToCanonical(knownCharacters);
  
  // Определяем каких спикеров калибрируем
  const targetSpeakers = speakersToCalibrate || diarizationResult.speakers;
  
  console.log(`\n🎯 CALIBRATING SPEAKERS → CHARACTERS...`);
  console.log(`   Known characters: ${knownCharacters.length}`);
  console.log(`   Speakers to map: ${targetSpeakers.length} (${speakersToCalibrate ? 'filtered' : 'all'})`);
  console.log(`   Scenes to analyze: ${geminiScenes.length}`);
  console.log(`   Name variants mapped: ${variantToCanonical.size}`);
  
  // Функция поиска персонажа в тексте (с учётом вариантов)
  const findCharacterInText = (text: string): string | null => {
    const upper = text.toUpperCase();
    
    // Приоритет 1: Ищем имя в начале (формат "ГАЛЯ\nтекст")
    for (const char of knownCharacters) {
      if (upper.startsWith(char)) return char;
    }
    
    // Приоритет 2: Ищем ВАРИАНТ имени в начале (ТАНЬКА → ТАТЬЯНА)
    for (const [variant, canonical] of variantToCanonical) {
      if (upper.startsWith(variant) && !knownCharacters.includes(variant)) {
        console.log(`      🔄 Variant match: ${variant} → ${canonical}`);
        return canonical;
      }
    }
    
    // Приоритет 3: Ищем имя с глаголом речи (формат "Галя говорит")
    for (const char of knownCharacters) {
      const pattern = new RegExp(`\\b${char}\\b.{0,20}(говорит|отвечает|спрашивает|кричит)`, 'i');
      if (pattern.test(text)) return char;
    }
    
    // Приоритет 4: Ищем имя в начале строки внутри текста
    for (const char of knownCharacters) {
      const linePattern = new RegExp(`^${char}\\s*$|\\n${char}\\s*\\n`, 'mi');
      if (linePattern.test(text)) return char;
    }
    
    // Приоритет 5: Ищем ВАРИАНТ в любом месте текста
    for (const [variant, canonical] of variantToCanonical) {
      const linePattern = new RegExp(`^${variant}\\s*$|\\n${variant}\\s*\\n`, 'mi');
      if (linePattern.test(text) && !knownCharacters.includes(variant)) {
        console.log(`      🔄 Variant line match: ${variant} → ${canonical}`);
        return canonical;
      }
    }
    
    // Приоритет 6: Ищем имя персонажа ANYWHERE в тексте (менее строго)
    for (const char of knownCharacters) {
      const anywherePattern = new RegExp(`\\b${char}\\b`, 'i');
      if (anywherePattern.test(text)) return char;
    }
    
    return null;
  };
  
  // Функция поиска персонажа в ASR тексте
  // УНИВЕРСАЛЬНАЯ: ищем только имена из сценария, без хардкода
  const findCharacterInASR = (asrText: string): string | null => {
    const upper = asrText.toUpperCase();
    
    // Ищем прямые имена из сценария в ASR тексте
    for (const char of knownCharacters) {
      const pattern = new RegExp(`\\b${char}\\b`, 'i');
      if (pattern.test(upper)) return char;
    }
    
    return null;
  };
  
  // Функция поиска персонажа по обращению ("Танька!" → кто отвечает = ТАТЬЯНА)
  const findCharacterByAddress = (text: string): string | null => {
    const upper = text.toUpperCase();
    
    // Ищем обращения типа "Танька!" или "Тань,"
    for (const [variant, canonical] of variantToCanonical) {
      // Паттерн: обращение в начале или после восклицания
      const addressPattern = new RegExp(`(^|[!?.])\\s*${variant}[!,]`, 'i');
      if (addressPattern.test(upper) && !knownCharacters.includes(variant)) {
        console.log(`      📢 Address found: "${variant}" → ${canonical}`);
        return canonical;
      }
    }
    
    return null;
  };
  
  // Парсим все реплики из диалога (формат: "ПЕРСОНАЖ\nтекст\nПЕРСОНАЖ2\nтекст2")
  const parseDialogueReplies = (dialogue: string): Array<{ character: string; text: string }> => {
    const replies: Array<{ character: string; text: string }> = [];
    const lines = dialogue.split('\n');
    let currentChar = '';
    let currentText: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      const upper = trimmed.toUpperCase();
      
      // Проверяем это ли имя персонажа (короткая строка капсом или известный персонаж/вариант)
      const isCharacterName = (
        (trimmed.length < 20 && /^[А-ЯЁA-Z\s]+$/.test(trimmed)) ||
        knownCharacters.includes(upper) ||
        variantToCanonical.has(upper)
      );
      
      if (isCharacterName && trimmed.length > 0) {
        // Сохраняем предыдущую реплику
        if (currentChar && currentText.length > 0) {
          replies.push({ character: currentChar, text: currentText.join(' ') });
        }
        // Резолвим вариант в каноническое имя
        currentChar = variantToCanonical.get(upper) || upper;
        currentText = [];
      } else if (currentChar && trimmed.length > 0) {
        currentText.push(trimmed);
      }
    }
    
    // Последняя реплика
    if (currentChar && currentText.length > 0) {
      replies.push({ character: currentChar, text: currentText.join(' ') });
    }
    
    return replies;
  };
  
  // Анализируем сцены с диалогами
  for (const scene of geminiScenes) {
    const dialogueUpper = (scene.dialogues || '').toUpperCase();
    
    // Пропускаем сцены без речи (ASR не нашёл слов)
    const startMs = timecodeToMs(scene.start_timecode);
    const endMs = timecodeToMs(scene.end_timecode);
    const wordsInScene = diarizationResult.words.filter(w => w.start < endMs && w.end > startMs);
    
    if (wordsInScene.length < 3) continue;
    
    // Парсим реплики из диалога
    const replies = parseDialogueReplies(scene.dialogues || '');
    
    // Если нет реплик — пробуем старый способ
    if (replies.length === 0 && dialogueUpper && dialogueUpper !== 'МУЗЫКА') {
      const character = findCharacterInText(scene.dialogues);
      if (character && !assignedCharacters.has(character)) {
        const dominantSpeaker = getDominantSpeaker(diarizationResult.words, startMs, endMs);
        if (dominantSpeaker && !assignedSpeakers.has(dominantSpeaker)) {
          const speakerWords = getWordsForSpeakerInRange(diarizationResult.words, dominantSpeaker, startMs, endMs);
          if (speakerWords.length >= 3) {
            mappings.push({
              speakerId: dominantSpeaker,
              characterName: character,
              confidence: Math.min(speakerWords.length / 10, 1),
              calibrationTimecode: scene.start_timecode,
            });
            assignedSpeakers.add(dominantSpeaker);
            assignedCharacters.add(character);
            console.log(`   ✅ ${dominantSpeaker} → ${character} (${speakerWords.length} words at ${scene.start_timecode})`);
          }
        }
      }
      continue;
    }
    
    // Анализируем каждую реплику и связываем со спикером по времени
    // Находим уникальных спикеров в сцене
    const speakersInScene = new Set<string>();
    for (const w of wordsInScene) {
      speakersInScene.add(w.speaker);
    }
    
    // Группируем слова по спикерам (в порядке появления)
    const speakerSegments: Array<{ speaker: string; words: DiarizedWordFull[] }> = [];
    let currentSpeaker = '';
    let currentWords: DiarizedWordFull[] = [];
    
    for (const w of wordsInScene) {
      if (w.speaker !== currentSpeaker) {
        if (currentWords.length > 0) {
          speakerSegments.push({ speaker: currentSpeaker, words: currentWords });
        }
        currentSpeaker = w.speaker;
        currentWords = [w];
      } else {
        currentWords.push(w);
      }
    }
    if (currentWords.length > 0) {
      speakerSegments.push({ speaker: currentSpeaker, words: currentWords });
    }
    
    // Сопоставляем реплики с сегментами спикеров
    for (let i = 0; i < Math.min(replies.length, speakerSegments.length); i++) {
      const reply = replies[i];
      const segment = speakerSegments[i];
      
      // Пропускаем уже откалиброванных
      if (assignedSpeakers.has(segment.speaker)) continue;
      if (assignedCharacters.has(reply.character)) continue;
      if (speakersToCalibrate && !speakersToCalibrate.includes(segment.speaker)) continue;
      if (segment.words.length < 2) continue;
      
      // Калибруем!
      mappings.push({
        speakerId: segment.speaker,
        characterName: reply.character,
        confidence: Math.min(segment.words.length / 10, 1),
        calibrationTimecode: scene.start_timecode,
      });
      assignedSpeakers.add(segment.speaker);
      assignedCharacters.add(reply.character);
      console.log(`   ✅ ${segment.speaker} → ${reply.character} (${segment.words.length} words, reply #${i + 1} at ${scene.start_timecode})`);
    }
    
    // Также проверяем обращения: если кто-то зовёт "Танька!", найдём кто отвечает
    for (const reply of replies) {
      const addressee = findCharacterByAddress(reply.text);
      if (addressee && !assignedCharacters.has(addressee)) {
        // Ищем следующую реплику (того кто отвечает)
        const replyIndex = replies.indexOf(reply);
        if (replyIndex < replies.length - 1) {
          const nextReply = replies[replyIndex + 1];
          // Если следующая реплика от персонажа которого мы ищем — связываем
          if (nextReply.character === addressee && speakerSegments[replyIndex + 1]) {
            const segment = speakerSegments[replyIndex + 1];
            if (!assignedSpeakers.has(segment.speaker) && segment.words.length >= 2) {
              mappings.push({
                speakerId: segment.speaker,
                characterName: addressee,
                confidence: 0.9, // Высокая уверенность по обращению
                calibrationTimecode: scene.start_timecode,
              });
              assignedSpeakers.add(segment.speaker);
              assignedCharacters.add(addressee);
              console.log(`   ✅ ${segment.speaker} → ${addressee} (by address "${reply.text.slice(0, 20)}..." at ${scene.start_timecode})`);
            }
          }
        }
      }
    }
    
    // Если всех спикеров откалибровали — выходим
    if (assignedSpeakers.size >= diarizationResult.speakers.length) {
      console.log(`   🎉 All speakers calibrated!`);
      break;
    }
  }
  
  // Fallback: ищем персонажей в описаниях
  for (const scene of geminiScenes) {
    if (assignedSpeakers.size >= diarizationResult.speakers.length) break;
    
    const startMs = timecodeToMs(scene.start_timecode);
    const endMs = timecodeToMs(scene.end_timecode);
    const wordsInScene = diarizationResult.words.filter(w => w.start < endMs && w.end > startMs);
    
    if (wordsInScene.length < 3) continue;
    
    // Ищем в описании (если персонаж "говорит/отвечает")
    const character = findCharacterInText(scene.description || '');
    if (!character || assignedCharacters.has(character)) continue;
    
    // Находим доминантного спикера в это время
    const dominantSpeaker = getDominantSpeaker(diarizationResult.words, startMs, endMs);
    
    // Пропускаем если спикер уже откалиброван или не в списке целевых
    if (!dominantSpeaker || assignedSpeakers.has(dominantSpeaker)) continue;
    if (speakersToCalibrate && !speakersToCalibrate.includes(dominantSpeaker)) continue;
    
    // Проверяем что этот спикер действительно много говорит в этой сцене
    const speakerWords = getWordsForSpeakerInRange(
      diarizationResult.words,
      dominantSpeaker,
      startMs,
      endMs
    );
    
    if (speakerWords.length < 3) continue;
    
    // Калибруем!
    mappings.push({
      speakerId: dominantSpeaker,
      characterName: character,
      confidence: Math.min(speakerWords.length / 10, 1), // Больше слов = больше уверенность
      calibrationTimecode: scene.start_timecode,
    });
    
    assignedSpeakers.add(dominantSpeaker);
    assignedCharacters.add(character);
    
    console.log(`   ✅ ${dominantSpeaker} → ${character} (${speakerWords.length} words at ${scene.start_timecode})`);
    
    // Если всех спикеров откалибровали — выходим
    if (assignedSpeakers.size >= diarizationResult.speakers.length) {
      console.log(`   🎉 All speakers calibrated!`);
      break;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // FALLBACK 2: Используем сам ASR текст для идентификации
  // Если в ASR есть обращения типа "Таненька!" — знаем что ТАНЯ в сцене
  // ═══════════════════════════════════════════════════════════════
  for (const scene of geminiScenes) {
    if (assignedSpeakers.size >= diarizationResult.speakers.length) break;
    
    const startMs = timecodeToMs(scene.start_timecode);
    const endMs = timecodeToMs(scene.end_timecode);
    const wordsInScene = diarizationResult.words.filter(w => w.start < endMs && w.end > startMs);
    
    if (wordsInScene.length < 3) continue;
    
    // Собираем текст ASR для этой сцены
    const asrText = wordsInScene.map(w => w.word).join(' ');
    
    // Ищем персонажа по ASR тексту (обращения, имена)
    const character = findCharacterInASR(asrText);
    if (!character || assignedCharacters.has(character)) continue;
    
    // Находим кто больше всего говорит (доминант) — это скорее всего НЕ тот, кого зовут
    // Тот кого зовут — это тот кто ОТВЕЧАЕТ после обращения
    const dominantSpeaker = getDominantSpeaker(diarizationResult.words, startMs, endMs);
    
    if (!dominantSpeaker || assignedSpeakers.has(dominantSpeaker)) continue;
    if (speakersToCalibrate && !speakersToCalibrate.includes(dominantSpeaker)) continue;
    
    const speakerWords = getWordsForSpeakerInRange(diarizationResult.words, dominantSpeaker, startMs, endMs);
    if (speakerWords.length < 3) continue;
    
    // Калибруем!
    mappings.push({
      speakerId: dominantSpeaker,
      characterName: character,
      confidence: 0.7, // Средняя уверенность по ASR
      calibrationTimecode: scene.start_timecode,
    });
    
    assignedSpeakers.add(dominantSpeaker);
    assignedCharacters.add(character);
    
    console.log(`   ✅ ${dominantSpeaker} → ${character} (by ASR mention at ${scene.start_timecode})`);
  }
  
  console.log(`\n📊 Calibration complete: ${mappings.length}/${diarizationResult.speakers.length} speakers mapped`);
  
  return mappings;
}

/**
 * Конвертирует маппинг в простой Record для использования
 */
export function mappingToRecord(mappings: SpeakerCharacterMapping[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const m of mappings) {
    record[m.speakerId] = m.characterName;
  }
  return record;
}

// ═══════════════════════════════════════════════════════════════
// СЕРИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════

/**
 * Сериализует данные диаризации для сохранения в БД
 */
export function serializeDiarization(data: VideoDiarizationData): string {
  return JSON.stringify(data);
}

/**
 * Десериализует данные диаризации из БД
 */
export function deserializeDiarization(json: string): VideoDiarizationData | null {
  try {
    return JSON.parse(json) as VideoDiarizationData;
  } catch {
    return null;
  }
}

/**
 * Оценивает стоимость диаризации (AssemblyAI: $0.00025/секунду)
 */
export function estimateCost(durationSeconds: number): number {
  return durationSeconds * 0.00025;
}

