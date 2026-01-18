/**
 * Smart Scene Merger — умное объединение коротких планов
 * 
 * Цель: Не терять настоящие scene changes, но убирать "шум" (вспышки, микро-движения)
 */

export interface SceneWithMetadata {
  timecode: string;
  timestamp: number;
  frameNumber: number;
  duration?: number;
  sceneType?: 'cut' | 'dissolve' | 'fade';
}

/**
 * Умное объединение сцен по правилам:
 * 1. Сцены <0.3 сек — всегда объединяем (вспышки, артефакты)
 * 2. Сцены 0.3-0.8 сек — смотрим на контекст (аудио, последовательность)
 * 3. Сцены >0.8 сек — оставляем как есть
 */
export function smartMergeScenes(
  scenes: SceneWithMetadata[],
  options: {
    ultraShortThreshold?: number;  // <0.3 сек — всегда убираем
    shortThreshold?: number;        // 0.3-0.8 сек — проверяем контекст
    minFinalDuration?: number;      // Минимальная длительность итоговой сцены
  } = {}
): SceneWithMetadata[] {
  const {
    ultraShortThreshold = 0.3,  // <0.3 сек — точно артефакт
    shortThreshold = 0.8,       // <0.8 сек — проверяем
    minFinalDuration = 0.25,    // Итоговая сцена >0.25 сек
  } = options;

  if (scenes.length === 0) return [];

  // Вычисляем длительности
  const scenesWithDuration = scenes.map((scene, i) => ({
    ...scene,
    duration: i < scenes.length - 1 
      ? scenes[i + 1].timestamp - scene.timestamp 
      : 0,
  }));

  const merged: SceneWithMetadata[] = [scenesWithDuration[0]];
  let mergeCount = 0;

  for (let i = 1; i < scenesWithDuration.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = scenesWithDuration[i];
    const prevDuration = curr.timestamp - prev.timestamp;
    
    // Условия объединения:
    const isUltraShort = prevDuration < ultraShortThreshold;
    const isSameTypeSequence = prev.sceneType === curr.sceneType; // Одинаковый тип перехода
    
    // Объединяем если:
    // - Сцена <0.3 сек (вспышка, артефакт)
    // - ИЛИ сцена <0.8 сек И одинаковый тип перехода (серия быстрых cut'ов)
    const shouldMerge = isUltraShort || 
                       (prevDuration < shortThreshold && isSameTypeSequence);
    
    if (shouldMerge) {
      // Не добавляем новую сцену — расширяем предыдущую
      mergeCount++;
      // prev.duration увеличится автоматически когда добавим следующую
    } else {
      merged.push(curr);
    }
  }

  console.log(`\n🔀 Smart Scene Merging:`);
  console.log(`   Input: ${scenes.length} scenes`);
  console.log(`   Merged: ${mergeCount} ultra-short scenes (<${ultraShortThreshold}s)`);
  console.log(`   Output: ${merged.length} scenes`);
  console.log(`   Reduction: ${(mergeCount / scenes.length * 100).toFixed(1)}%`);

  return merged;
}

/**
 * Альтернативный метод: объединение на основе аудио-контекста
 */
export function mergeByAudioContext(
  scenes: SceneWithMetadata[],
  audioWords: Array<{ start: number; end: number; speaker: string; text: string }>
): SceneWithMetadata[] {
  const merged: SceneWithMetadata[] = [scenes[0]];

  for (let i = 1; i < scenes.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = scenes[i];
    
    // Проверяем: есть ли диалог на границе сцен?
    const boundaryTime = curr.timestamp;
    const wordsAroundBoundary = audioWords.filter(w => 
      Math.abs(w.start - boundaryTime) < 0.3 || 
      Math.abs(w.end - boundaryTime) < 0.3
    );
    
    // Если на границе сцены нет диалога — возможно это ложный scene change
    const hasSpeechAtBoundary = wordsAroundBoundary.length > 0;
    const duration = curr.timestamp - prev.timestamp;
    
    // Объединяем если:
    // - Сцена короткая (<0.5 сек) И нет речи на границе
    if (duration < 0.5 && !hasSpeechAtBoundary) {
      // Это вероятно артефакт (вспышка, движение камеры)
      // Не добавляем curr в merged
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
