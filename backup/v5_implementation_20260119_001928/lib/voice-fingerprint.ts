/**
 * Voice Fingerprint Module
 * 
 * Использует TitaNet от NVIDIA (через Replicate) для:
 * 1. Извлечения voice embeddings из аудио
 * 2. Сравнения голосов для идентификации персонажей
 * 3. Калибровки speaker → character mapping
 */

import Replicate from 'replicate';

// TitaNet модель на Replicate
const TITANET_MODEL = 'adirik/titanet-large';

/**
 * Voice embedding — вектор голоса
 */
export interface VoiceEmbedding {
  characterName: string;
  embedding: number[];        // 192-dim vector от TitaNet
  sampleTimecode: string;     // Когда был записан образец
  confidence: number;         // Уверенность (0-1)
}

/**
 * Результат сравнения голосов
 */
export interface VoiceMatch {
  characterName: string;
  similarity: number;         // Cosine similarity (0-1)
  isMatch: boolean;           // similarity > threshold
}

/**
 * Калибровочные данные для видео
 */
export interface VoiceCalibrationData {
  videoId: string;
  embeddings: VoiceEmbedding[];
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════

/**
 * Извлекает voice embedding из аудио файла
 * 
 * @param audioUrl - URL аудио файла
 * @param replicate - инстанс Replicate клиента
 * @returns embedding vector (192 dimensions)
 */
export async function extractVoiceEmbedding(
  audioUrl: string,
  replicate: Replicate
): Promise<number[]> {
  console.log(`🎤 TitaNet: Extracting voice embedding...`);
  console.log(`   Audio: ${audioUrl.substring(0, 60)}...`);
  
  try {
    const output = await replicate.run(TITANET_MODEL as `${string}/${string}`, {
      input: {
        audio: audioUrl,
      },
    });
    
    // TitaNet возвращает embedding как массив чисел
    if (Array.isArray(output)) {
      console.log(`   ✅ Embedding extracted: ${output.length} dimensions`);
      return output as number[];
    }
    
    // Или как объект с полем embedding
    if (output && typeof output === 'object' && 'embedding' in output) {
      const embedding = (output as { embedding: number[] }).embedding;
      console.log(`   ✅ Embedding extracted: ${embedding.length} dimensions`);
      return embedding;
    }
    
    console.error(`   ❌ Unexpected TitaNet output:`, output);
    throw new Error('TitaNet returned unexpected format');
  } catch (error) {
    console.error(`   ❌ TitaNet error:`, error);
    throw error;
  }
}

/**
 * Вычисляет cosine similarity между двумя embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Находит наиболее похожий голос из калибровочных данных
 * 
 * @param embedding - embedding текущего голоса
 * @param calibration - сохранённые embeddings персонажей
 * @param threshold - минимальный порог сходства (default: 0.75)
 * @returns лучшее совпадение или null
 */
export function findBestVoiceMatch(
  embedding: number[],
  calibration: VoiceCalibrationData,
  threshold: number = 0.75
): VoiceMatch | null {
  if (!calibration.embeddings || calibration.embeddings.length === 0) {
    return null;
  }
  
  let bestMatch: VoiceMatch | null = null;
  let bestSimilarity = -1;
  
  for (const voiceEmbed of calibration.embeddings) {
    const similarity = cosineSimilarity(embedding, voiceEmbed.embedding);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = {
        characterName: voiceEmbed.characterName,
        similarity,
        isMatch: similarity >= threshold,
      };
    }
  }
  
  if (bestMatch) {
    console.log(`   🎯 Best voice match: ${bestMatch.characterName} (${(bestMatch.similarity * 100).toFixed(1)}%)`);
  }
  
  return bestMatch;
}

/**
 * Извлекает аудио сегмент из видео для анализа голоса
 * 
 * @param videoUrl - URL видео
 * @param startMs - начало в миллисекундах
 * @param endMs - конец в миллисекундах
 * @returns URL временного аудио файла
 */
export async function extractAudioSegment(
  videoUrl: string,
  startMs: number,
  endMs: number
): Promise<string> {
  // TODO: Реализовать извлечение аудио сегмента
  // Пока возвращаем полный URL (будем передавать весь чанк)
  console.log(`   📎 Audio segment: ${startMs}ms - ${endMs}ms`);
  return videoUrl;
}

// ═══════════════════════════════════════════════════════════════
// КАЛИБРОВКА
// ═══════════════════════════════════════════════════════════════

/**
 * Калибрует голоса персонажей из первого чанка
 * 
 * Логика:
 * 1. Gemini определяет кто говорит визуально
 * 2. TitaNet извлекает embedding голоса в этот момент
 * 3. Сохраняем пару: персонаж → embedding
 */
export async function calibrateVoicesFromChunk(
  scenes: Array<{
    start_timecode: string;
    end_timecode: string;
    description: string;
    dialogues: string;
  }>,
  speakerWords: Array<{
    word: string;
    start: number;
    end: number;
    speaker: string;
  }>,
  audioUrl: string,
  knownCharacters: string[],
  replicate: Replicate,
  timecodeToSeconds: (tc: string) => number
): Promise<VoiceEmbedding[]> {
  const embeddings: VoiceEmbedding[] = [];
  const calibratedCharacters = new Set<string>();
  
  console.log(`\n🎤 VOICE CALIBRATION: Extracting voice fingerprints...`);
  
  // Находим сцены где Gemini чётко определил говорящего
  const scenesWithSpeaker = scenes.filter(s => {
    const dialogueUpper = s.dialogues?.toUpperCase() || '';
    // Ищем сцены где диалог начинается с имени персонажа
    return knownCharacters.some(c => dialogueUpper.startsWith(c));
  });
  
  console.log(`   Found ${scenesWithSpeaker.length} scenes with identified speakers`);
  
  for (const scene of scenesWithSpeaker.slice(0, 5)) { // Берём первые 5 для калибровки
    // Определяем персонажа из диалога
    const dialogueUpper = scene.dialogues?.toUpperCase() || '';
    const character = knownCharacters.find(c => dialogueUpper.startsWith(c));
    
    if (!character || calibratedCharacters.has(character)) continue;
    
    // Находим временной диапазон сцены
    const sceneStartMs = timecodeToSeconds(scene.start_timecode) * 1000;
    const sceneEndMs = timecodeToSeconds(scene.end_timecode) * 1000;
    
    // Проверяем есть ли речь в этом диапазоне
    const wordsInScene = speakerWords.filter(w => 
      w.start >= sceneStartMs - 500 && w.end <= sceneEndMs + 500
    );
    
    if (wordsInScene.length < 3) {
      console.log(`   ⚠️ ${character}: not enough speech in scene`);
      continue;
    }
    
    console.log(`   🎤 Calibrating ${character} from ${scene.start_timecode}...`);
    
    try {
      // Извлекаем embedding голоса
      // Примечание: TitaNet работает с полным аудио, мы передаём URL чанка
      const embedding = await extractVoiceEmbedding(audioUrl, replicate);
      
      embeddings.push({
        characterName: character,
        embedding,
        sampleTimecode: scene.start_timecode,
        confidence: 0.8, // Начальная уверенность
      });
      
      calibratedCharacters.add(character);
      console.log(`   ✅ ${character}: voice fingerprint saved`);
      
    } catch (error) {
      console.error(`   ❌ ${character}: calibration failed:`, error);
    }
  }
  
  console.log(`\n📊 Voice calibration complete: ${embeddings.length} characters`);
  for (const e of embeddings) {
    console.log(`   • ${e.characterName} (confidence: ${(e.confidence * 100).toFixed(0)}%)`);
  }
  
  return embeddings;
}

/**
 * Идентифицирует спикера по голосу
 */
export async function identifySpeakerByVoice(
  audioUrl: string,
  calibration: VoiceCalibrationData,
  replicate: Replicate,
  threshold: number = 0.75
): Promise<string | null> {
  if (!calibration.embeddings || calibration.embeddings.length === 0) {
    return null;
  }
  
  try {
    const embedding = await extractVoiceEmbedding(audioUrl, replicate);
    const match = findBestVoiceMatch(embedding, calibration, threshold);
    
    if (match && match.isMatch) {
      return match.characterName;
    }
    
    return null;
  } catch (error) {
    console.error(`Voice identification failed:`, error);
    return null;
  }
}

/**
 * Сериализует калибровочные данные для сохранения в БД
 */
export function serializeCalibration(data: VoiceCalibrationData): string {
  return JSON.stringify(data);
}

/**
 * Десериализует калибровочные данные из БД
 */
export function deserializeCalibration(json: string): VoiceCalibrationData | null {
  try {
    return JSON.parse(json) as VoiceCalibrationData;
  } catch {
    return null;
  }
}
