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
      speakers_expected: Math.min(maxSpeakers, 10),
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
// ВАРИАНТЫ ИМЁН ДЛЯ ТОЧНОЙ КАЛИБРОВКИ
// ═══════════════════════════════════════════════════════════════
const NAME_VARIANTS: Record<string, string[]> = {
  'ТАТЬЯНА': ['ТАНЯ', 'ТАНЬКА', 'ТАНЮША', 'ТАНЮХА', 'ТАНЬ'],
  'ТАМАРА': ['ТОМА', 'ТОМКА', 'ТОМОЧКА'],  // ТОМА ≠ ТАНЯ!
  'ГАЛИНА': ['ГАЛЯ', 'ГАЛОЧКА', 'ГАЛЮСЯ', 'ГАЛЬКА'],
  'СВЕТЛАНА': ['СВЕТА', 'СВЕТИК', 'СВЕТОЧКА', 'СВЕТКА'],
  'ЕЛЕНА': ['ЛЕНА', 'ЛЕНОЧКА', 'ЛЕНКА'],
  'НАТАЛЬЯ': ['НАТАША', 'НАТАШКА', 'НАТУЛЯ'],
  'ВАЛЕНТИНА': ['ВАЛЯ', 'ВАЛЮША', 'ВАЛЬКА'],
  'АЛЕКСАНДРА': ['САША', 'ШУРА', 'ШУРОЧКА'],
  'ЛЮДМИЛА': ['ЛЮДА', 'ЛЮДАСЯ', 'ЛЮДОЧКА', 'ЛЮСЯ'],
  'МАРИЯ': ['МАША', 'МАШКА', 'МАРУСЯ'],
  'ЕКАТЕРИНА': ['КАТЯ', 'КАТЮША', 'КАТЬКА'],
  'АННА': ['АНЯ', 'АНЮТА', 'НЮРА'],
  'ИРИНА': ['ИРА', 'ИРОЧКА', 'ИРКА'],
  'ОЛЬГА': ['ОЛЯ', 'ОЛЕЧКА', 'ОЛЬКА'],
  'ВАРВАРА': ['ВАРЯ', 'ВАРЬКА', 'ВАРЮША'],
  'ЛАРИСА': ['ЛАРА', 'ЛАРИСКА', 'ЛАРКА'],
  'ЗИНАИДА': ['ЗИНА', 'ЗИНКА', 'ЗИНУЛЯ'],
};

// Обратный маппинг: вариант → каноническое имя
function buildVariantToCanonical(knownCharacters: string[]): Map<string, string> {
  const map = new Map<string, string>();
  
  for (const char of knownCharacters) {
    map.set(char, char);
    
    // Добавляем известные варианты
    const variants = NAME_VARIANTS[char];
    if (variants) {
      for (const v of variants) {
        // Если вариант не является отдельным персонажем — маппим на каноническое
        if (!knownCharacters.includes(v)) {
          map.set(v, char);
        }
      }
    }
    
    // Обратный поиск: если char это вариант кого-то
    for (const [canonical, variants] of Object.entries(NAME_VARIANTS)) {
      if (variants.includes(char) && knownCharacters.includes(canonical)) {
        map.set(char, canonical);
      }
    }
  }
  
  return map;
}

/**
 * Калибрует маппинг Speaker → Character используя визуальные подсказки от Gemini
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
  _fullDiarizationWords?: unknown,
  speakersToCalibrate?: string[]
): SpeakerCharacterMapping[] {
  const mappings: SpeakerCharacterMapping[] = [];
  const assignedSpeakers = new Set<string>();
  const assignedCharacters = new Set<string>();
  
  const variantToCanonical = buildVariantToCanonical(knownCharacters);
  const targetSpeakers = speakersToCalibrate || diarizationResult.speakers;
  
  console.log(`\n🎯 CALIBRATING SPEAKERS → CHARACTERS...`);
  console.log(`   Known characters: ${knownCharacters.length}`);
  console.log(`   Speakers to map: ${targetSpeakers.length}`);
  console.log(`   Scenes to analyze: ${geminiScenes.length}`);
  
  const findCharacterInText = (text: string): string | null => {
    const upper = text.toUpperCase();
    
    for (const char of knownCharacters) {
      if (upper.startsWith(char)) return char;
    }
    
    for (const [variant, canonical] of variantToCanonical) {
      if (upper.startsWith(variant) && !knownCharacters.includes(variant)) {
        return canonical;
      }
    }
    
    for (const char of knownCharacters) {
      const pattern = new RegExp(`\\b${char}\\b.{0,20}(говорит|отвечает|спрашивает|кричит)`, 'i');
      if (pattern.test(text)) return char;
    }
    
    for (const char of knownCharacters) {
      const linePattern = new RegExp(`^${char}\\s*$|\\n${char}\\s*\\n`, 'mi');
      if (linePattern.test(text)) return char;
    }
    
    return null;
  };
  
  for (const scene of geminiScenes) {
    const dialogueUpper = (scene.dialogues || '').toUpperCase();
    
    const startMs = timecodeToMs(scene.start_timecode);
    const endMs = timecodeToMs(scene.end_timecode);
    const wordsInScene = diarizationResult.words.filter(w => w.start < endMs && w.end > startMs);
    
    if (wordsInScene.length < 3) continue;
    
    let character: string | null = null;
    
    if (dialogueUpper && dialogueUpper !== 'МУЗЫКА') {
      character = findCharacterInText(scene.dialogues);
    }
    
    if (!character && scene.description) {
      character = findCharacterInText(scene.description);
    }
    
    if (!character || assignedCharacters.has(character)) continue;
    
    const dominantSpeaker = getDominantSpeaker(diarizationResult.words, startMs, endMs);
    
    if (!dominantSpeaker || assignedSpeakers.has(dominantSpeaker)) continue;
    if (speakersToCalibrate && !speakersToCalibrate.includes(dominantSpeaker)) continue;
    
    const speakerWords = getWordsForSpeakerInRange(diarizationResult.words, dominantSpeaker, startMs, endMs);
    
    if (speakerWords.length < 3) continue;
    
    mappings.push({
      speakerId: dominantSpeaker,
      characterName: character,
      confidence: Math.min(speakerWords.length / 10, 1),
      calibrationTimecode: scene.start_timecode,
    });
    
    assignedSpeakers.add(dominantSpeaker);
    assignedCharacters.add(character);
    
    console.log(`   ✅ ${dominantSpeaker} → ${character} (${speakerWords.length} words at ${scene.start_timecode})`);
    
    if (assignedSpeakers.size >= diarizationResult.speakers.length) {
      console.log(`   🎉 All speakers calibrated!`);
      break;
    }
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

export function serializeDiarization(data: VideoDiarizationData): string {
  return JSON.stringify(data);
}

export function deserializeDiarization(json: string): VideoDiarizationData | null {
  try {
    return JSON.parse(json) as VideoDiarizationData;
  } catch {
    return null;
  }
}

export function estimateCost(durationSeconds: number): number {
  return durationSeconds * 0.00025;
}
