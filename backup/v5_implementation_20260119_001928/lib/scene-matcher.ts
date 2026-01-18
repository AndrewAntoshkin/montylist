/**
 * Scene Matcher - сопоставляет Gemini описания с FFmpeg таймкодами
 * 
 * Принцип работы:
 * - FFmpeg даёт ТОЧНЫЕ таймкоды (технические монтажные склейки)
 * - Gemini даёт СОДЕРЖАНИЕ (описания, диалоги, типы планов)
 * - Matcher находит ближайшее Gemini описание для каждого FFmpeg таймкода
 */

import { type ParsedScene } from '@/types';
import { timecodeToSeconds } from './video-chunking';

export interface FFmpegScene {
  timecode: string;   // HH:MM:SS:FF
  timestamp: number;  // seconds
}

export interface MatchingResult {
  matched: ParsedScene[];
  unmatched: {
    ffmpegWithoutGemini: FFmpegScene[];
    geminiWithoutFFmpeg: ParsedScene[];
  };
  stats: {
    totalFFmpegScenes: number;
    totalGeminiScenes: number;
    matchedCount: number;
    avgMatchDistance: number;
  };
}

/**
 * Сопоставляет Gemini описания с FFmpeg таймкодами
 * 
 * @param geminiScenes - Сцены от Gemini с описаниями и диалогами
 * @param ffmpegScenes - Сцены от FFmpeg с точными таймкодами
 * @param toleranceSeconds - Максимальное расстояние для matching (по умолчанию 2 сек)
 */
export function matchGeminiToFFmpeg(
  geminiScenes: ParsedScene[],
  ffmpegScenes: FFmpegScene[],
  toleranceSeconds: number = 2.0
): MatchingResult {
  const matched: ParsedScene[] = [];
  const usedGeminiIndices = new Set<number>();
  const matchDistances: number[] = [];
  
  // Для каждой FFmpeg сцены найти ближайшее Gemini описание
  for (let i = 0; i < ffmpegScenes.length; i++) {
    const ffmpegScene = ffmpegScenes[i];
    const nextFFmpegScene = ffmpegScenes[i + 1];
    
    // Найти ближайшее Gemini описание в пределах tolerance
    const { geminiIndex, distance } = findClosestGeminiScene(
      geminiScenes,
      ffmpegScene.timestamp,
      usedGeminiIndices,
      toleranceSeconds
    );
    
    if (geminiIndex !== -1) {
      const geminiScene = geminiScenes[geminiIndex];
      usedGeminiIndices.add(geminiIndex);
      matchDistances.push(distance);
      
      // Создаём matched сцену: FFmpeg таймкод + Gemini контент
      matched.push({
        timecode: `${ffmpegScene.timecode} - ${nextFFmpegScene?.timecode || geminiScene.end_timecode}`,
        start_timecode: ffmpegScene.timecode,
        end_timecode: nextFFmpegScene?.timecode || geminiScene.end_timecode,
        plan_type: geminiScene.plan_type,
        description: geminiScene.description,
        dialogues: geminiScene.dialogues,
      });
    } else {
      // FFmpeg сцена без Gemini описания - создаём пустую запись
      matched.push({
        timecode: `${ffmpegScene.timecode} - ${nextFFmpegScene?.timecode || ffmpegScene.timecode}`,
        start_timecode: ffmpegScene.timecode,
        end_timecode: nextFFmpegScene?.timecode || ffmpegScene.timecode,
        plan_type: 'Ср.',  // Default type
        description: '',   // Empty - no Gemini description
        dialogues: 'Музыка',
      });
    }
  }
  
  // Найти unmatched сцены
  const ffmpegWithoutGemini = ffmpegScenes.filter((_, i) => {
    // Check if this FFmpeg scene got an empty description
    return matched[i]?.description === '';
  });
  
  const geminiWithoutFFmpeg = geminiScenes.filter((_, i) => !usedGeminiIndices.has(i));
  
  // Рассчитать статистику
  const avgMatchDistance = matchDistances.length > 0
    ? matchDistances.reduce((a, b) => a + b, 0) / matchDistances.length
    : 0;
  
  console.log(`\n🔗 Matching results:`);
  console.log(`   FFmpeg scenes: ${ffmpegScenes.length}`);
  console.log(`   Gemini scenes: ${geminiScenes.length}`);
  console.log(`   Matched: ${usedGeminiIndices.size}`);
  console.log(`   FFmpeg without Gemini: ${ffmpegWithoutGemini.length}`);
  console.log(`   Gemini without FFmpeg: ${geminiWithoutFFmpeg.length}`);
  console.log(`   Avg match distance: ${avgMatchDistance.toFixed(2)}s`);
  
  return {
    matched,
    unmatched: {
      ffmpegWithoutGemini,
      geminiWithoutFFmpeg,
    },
    stats: {
      totalFFmpegScenes: ffmpegScenes.length,
      totalGeminiScenes: geminiScenes.length,
      matchedCount: usedGeminiIndices.size,
      avgMatchDistance,
    },
  };
}

/**
 * Находит ближайшую Gemini сцену к заданному timestamp
 */
function findClosestGeminiScene(
  geminiScenes: ParsedScene[],
  targetTimestamp: number,
  usedIndices: Set<number>,
  toleranceSeconds: number
): { geminiIndex: number; distance: number } {
  let closestIndex = -1;
  let closestDistance = Infinity;
  
  for (let i = 0; i < geminiScenes.length; i++) {
    // Пропустить уже использованные сцены
    if (usedIndices.has(i)) continue;
    
    const geminiTimestamp = timecodeToSeconds(geminiScenes[i].start_timecode);
    const distance = Math.abs(geminiTimestamp - targetTimestamp);
    
    if (distance < closestDistance && distance <= toleranceSeconds) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  
  return { geminiIndex: closestIndex, distance: closestDistance };
}

/**
 * Фильтрует FFmpeg сцены для конкретного чанка
 */
export function filterFFmpegScenesForChunk(
  allScenes: FFmpegScene[],
  chunkStartTimecode: string,
  chunkEndTimecode: string
): FFmpegScene[] {
  const chunkStartSeconds = timecodeToSeconds(chunkStartTimecode);
  const chunkEndSeconds = timecodeToSeconds(chunkEndTimecode);
  
  return allScenes.filter(scene => 
    scene.timestamp >= chunkStartSeconds && scene.timestamp < chunkEndSeconds
  );
}

/**
 * Создаёт boundaries (start/end пары) из массива FFmpeg сцен
 */
export function scenesToBoundaries(scenes: FFmpegScene[]): Array<{
  start_timecode: string;
  end_timecode: string;
}> {
  const boundaries = [];
  
  for (let i = 0; i < scenes.length - 1; i++) {
    boundaries.push({
      start_timecode: scenes[i].timecode,
      end_timecode: scenes[i + 1].timecode,
    });
  }
  
  return boundaries;
}

/**
 * Проверяет качество matching и логирует предупреждения
 */
export function validateMatching(result: MatchingResult): string[] {
  const warnings: string[] = [];
  
  // Предупреждение если много unmatched
  const unmatchedRatio = result.unmatched.geminiWithoutFFmpeg.length / result.stats.totalGeminiScenes;
  if (unmatchedRatio > 0.2) {
    warnings.push(`⚠️ ${(unmatchedRatio * 100).toFixed(0)}% Gemini сцен не нашли соответствия в FFmpeg`);
  }
  
  // Предупреждение если большая дистанция matching
  if (result.stats.avgMatchDistance > 1.0) {
    warnings.push(`⚠️ Средняя дистанция matching ${result.stats.avgMatchDistance.toFixed(2)}s - возможны неточности`);
  }
  
  // Предупреждение если сильно разное количество сцен
  const countDiff = Math.abs(result.stats.totalFFmpegScenes - result.stats.totalGeminiScenes);
  const maxCount = Math.max(result.stats.totalFFmpegScenes, result.stats.totalGeminiScenes);
  if (countDiff / maxCount > 0.3) {
    warnings.push(`⚠️ Большая разница в количестве сцен: FFmpeg=${result.stats.totalFFmpegScenes}, Gemini=${result.stats.totalGeminiScenes}`);
  }
  
  return warnings;
}



