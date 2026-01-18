/**
 * Whisper Diarization — ASR + Speaker Detection via Replicate
 * 
 * Использует thomasmol/whisper-diarization:
 * - Whisper Large V3 Turbo для транскрипции
 * - Pyannote 3.3 для diarization
 * - Word-level timestamps
 * 
 * @see https://replicate.com/thomasmol/whisper-diarization
 */

import Replicate from 'replicate';
import { pollPrediction } from './replicate-helper';

/**
 * Слово с таймкодом и вероятностью
 */
export interface DiarizedWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

/**
 * Сегмент речи с speaker_id
 */
export interface DiarizedSegment {
  speaker: string;      // "SPEAKER_00", "SPEAKER_01", etc.
  start: number;        // секунды
  end: number;          // секунды
  text: string;         // транскрипция сегмента
  words?: DiarizedWord[]; // word-level timestamps
  avg_logprob?: number;
}

/**
 * Результат diarization
 */
export interface DiarizationResult {
  segments: DiarizedSegment[];
  num_speakers: number;
  language: string;
}

/**
 * Опции для diarization
 */
export interface DiarizationOptions {
  language?: string;      // код языка, default: auto-detect
  numSpeakers?: number;   // количество спикеров (1-50), default: auto-detect
  prompt?: string;        // vocabulary hints (имена, аббревиатуры)
}

/**
 * Транскрибирует аудио/видео с определением спикеров
 * 
 * @param fileUrl - URL аудио или видео файла
 * @param options - опции diarization
 * @returns результат с сегментами, спикерами и word-level timestamps
 */
export async function transcribeWithDiarization(
  fileUrl: string,
  options: DiarizationOptions = {}
): Promise<DiarizationResult> {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN_1!,
  });
  
  const input: Record<string, unknown> = {
    file_url: fileUrl,
  };
  
  if (options.language) {
    input.language = options.language;
  }
  
  if (options.numSpeakers && options.numSpeakers >= 1 && options.numSpeakers <= 50) {
    input.num_speakers = options.numSpeakers;
  }
  
  if (options.prompt) {
    input.prompt = options.prompt;
  }
  
  console.log(`🎤 Calling whisper-diarization...`);
  console.log(`   URL: ${fileUrl.substring(0, 80)}...`);
  console.log(`   Options: ${JSON.stringify(options)}`);
  
  // Community модели требуют version вместо model
  const WHISPER_DIARIZATION_VERSION = "1495a9cddc83b2203b0d8d3516e38b80fd1572ebc4bc5700ac1da56a9b3ed886";
  
  let prediction;
  let lastError: Error | null = null;
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} to create diarization prediction...`);
      
      prediction = await replicate.predictions.create({
        version: WHISPER_DIARIZATION_VERSION,
        input,
      });
      
      console.log(`✅ Diarization prediction created on attempt ${attempt}:`, prediction.id);
      break;
    } catch (error: any) {
      lastError = error;
      console.error(`❌ Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const waitTime = Math.pow(attempt, 2) * 2000;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  if (!prediction) {
    throw lastError || new Error('Failed to create diarization prediction');
  }
  
  console.log(`⏳ Polling diarization ${prediction.id}...`);
  const completedPrediction = await pollPrediction(replicate, prediction.id, 60, 5000);
  
  if (completedPrediction.status !== 'succeeded') {
    throw new Error(`Diarization failed: ${completedPrediction.error}`);
  }
  
  const output = completedPrediction.output as DiarizationResult;
  
  console.log(`✅ Diarization complete:`);
  console.log(`   Segments: ${output.segments?.length || 0}`);
  console.log(`   Speakers: ${output.num_speakers}`);
  console.log(`   Language: ${output.language}`);
  
  return output;
}

/**
 * Получает слова из сегментов для заданного временного диапазона
 * 
 * @param segments - сегменты от diarization
 * @param startTime - начало диапазона (секунды)
 * @param endTime - конец диапазона (секунды)
 * @param tolerance - допуск в секундах (default: 0.3)
 * @returns слова с speaker_id попадающие в диапазон
 */
export function getWordsInTimeRange(
  segments: DiarizedSegment[],
  startTime: number,
  endTime: number,
  tolerance: number = 0.3
): Array<DiarizedWord & { speaker: string }> {
  const result: Array<DiarizedWord & { speaker: string }> = [];
  
  for (const segment of segments) {
    if (!segment.words || segment.words.length === 0) continue;
    
    for (const word of segment.words) {
      // Слово попадает в диапазон если его начало в пределах [start-tolerance, end)
      if (word.start >= startTime - tolerance && word.start < endTime) {
        result.push({
          ...word,
          speaker: segment.speaker,
        });
      }
    }
  }
  
  return result;
}

/**
 * Формирует диалоги для плана из diarization сегментов
 * 
 * @param segments - сегменты от diarization
 * @param planStart - начало плана (секунды)
 * @param planEnd - конец плана (секунды)
 * @param speakerMapping - маппинг SPEAKER_XX → имя персонажа
 * @returns отформатированные диалоги или "Музыка"
 */
export function formatDialoguesForPlan(
  segments: DiarizedSegment[],
  planStart: number,
  planEnd: number,
  speakerMapping: Record<string, string>
): string {
  const wordsWithSpeakers = getWordsInTimeRange(segments, planStart, planEnd);
  
  if (wordsWithSpeakers.length === 0) {
    return 'Музыка';
  }
  
  // Группируем слова по спикерам (сохраняя порядок)
  const dialogues: Array<{ speaker: string; words: string[] }> = [];
  
  for (const word of wordsWithSpeakers) {
    const speakerName = speakerMapping[word.speaker] || word.speaker;
    const lastDialogue = dialogues[dialogues.length - 1];
    
    if (lastDialogue && lastDialogue.speaker === speakerName) {
      lastDialogue.words.push(word.word);
    } else {
      dialogues.push({
        speaker: speakerName,
        words: [word.word],
      });
    }
  }
  
  // Форматируем в строку
  return dialogues
    .map(d => `${d.speaker}\n${d.words.join(' ')}`)
    .join('\n\n');
}

/**
 * Извлекает уникальных спикеров из сегментов
 */
export function getUniqueSpeakers(segments: DiarizedSegment[]): string[] {
  const speakers = new Set<string>();
  for (const seg of segments) {
    speakers.add(seg.speaker);
  }
  return Array.from(speakers).sort();
}

/**
 * Получает первую реплику каждого спикера (для маппинга)
 */
export function getFirstUtterancePerSpeaker(
  segments: DiarizedSegment[]
): Map<string, { text: string; start: number; end: number }> {
  const result = new Map<string, { text: string; start: number; end: number }>();
  
  for (const seg of segments) {
    if (!result.has(seg.speaker)) {
      result.set(seg.speaker, {
        text: seg.text,
        start: seg.start,
        end: seg.end,
      });
    }
  }
  
  return result;
}

