/**
 * Credits Detector — определение заставок и финальных титров
 * 
 * Реальный монтажный лист:
 * - Заставка (00:00:04:09 - 00:01:06:13) = ОДИН план ~62 сек
 * - Финальные титры (00:47:32:00 - 00:48:19:12) = ОДИН план ~47 сек
 * 
 * FFmpeg детектирует каждую смену кадра → 20+ планов вместо одного
 * Этот модуль объединяет быстрые сцены обратно в один план
 */

export interface FFmpegScene {
  timecode: string;
  timestamp: number;
}

// Helper: timestamp (seconds) to timecode HH:MM:SS:FF
function timestampToTimecode(seconds: number, fps: number = 25): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

export interface MergedScene {
  start_timecode: string;
  end_timecode: string;
  start_timestamp: number;
  end_timestamp: number;
  type: 'opening_credits' | 'closing_credits' | 'regular';
  originalScenesCount: number;
}

/**
 * Детектирует заставку в начале видео
 * 
 * Критерии заставки:
 * 1. Начинается в первые 10 секунд видео
 * 2. Много быстрых смен (>10 сцен за 90 секунд)
 * 3. Средняя длительность сцены < 5 секунд
 */
export function detectOpeningCredits(
  scenes: FFmpegScene[],
  videoDuration: number
): { isCredits: boolean; endIndex: number; endTimestamp: number } {
  if (scenes.length < 5) {
    return { isCredits: false, endIndex: 0, endTimestamp: 0 };
  }

  // Окно анализа — до 2 минут (для длинных заставок)
  const maxCreditsTime = Math.min(120, videoDuration * 0.15);
  
  let creditsEndIndex = 0;
  let lastTimestamp = 0;
  
  // ═══════════════════════════════════════════════════════════════
  // УМНАЯ ДЕТЕКЦИЯ: ищем "точку перелома" — когда меняется характер сцен
  // Заставка: много быстрых перебивок (< 2 сек)
  // Диалог: более длинные кадры (> 2.5 сек)
  // ═══════════════════════════════════════════════════════════════
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    
    if (scene.timestamp > maxCreditsTime) {
      break;
    }
    
    // Нужно минимум 5 сцен для анализа
    if (i >= 5) {
      const recentScenes = scenes.slice(i - 4, i + 1);
      
      // Считаем среднюю длительность последних 5 сцен
      let totalDuration = 0;
      for (let j = 1; j < recentScenes.length; j++) {
        totalDuration += recentScenes[j].timestamp - recentScenes[j - 1].timestamp;
      }
      const avgDuration = totalDuration / 4;
      
      // Также смотрим на предыдущие 5 сцен (если есть)
      let prevAvgDuration = 0;
      if (i >= 10) {
        const prevScenes = scenes.slice(i - 9, i - 4);
        let prevTotal = 0;
        for (let j = 1; j < prevScenes.length; j++) {
          prevTotal += prevScenes[j].timestamp - prevScenes[j - 1].timestamp;
        }
        prevAvgDuration = prevTotal / 4;
      }
      
      // КРИТЕРИЙ 1: Резкий скачок длительности (сцены стали в 1.5+ раз длиннее)
      const durationJump = prevAvgDuration > 0 && avgDuration > prevAvgDuration * 1.5;
      
      // КРИТЕРИЙ 2: Средняя длительность > 2.5 сек (диалоговые сцены)
      const longScenes = avgDuration > 2.5;
      
      // КРИТЕРИЙ 3: Мы уже прошли минимум 30 секунд (логотип + начало заставки)
      const pastMinimum = scene.timestamp > 30;
      
      if (pastMinimum && (durationJump || (longScenes && i > 8))) {
        creditsEndIndex = i - 1;
        lastTimestamp = scenes[i - 1].timestamp;
        console.log(`🎬 Credits end: avgDuration=${avgDuration.toFixed(2)}s, prevAvg=${prevAvgDuration.toFixed(2)}s, jump=${durationJump}, at ${lastTimestamp.toFixed(1)}s`);
        break;
      }
    }
    
    creditsEndIndex = i;
    lastTimestamp = scene.timestamp;
  }
  
  // Проверяем что это похоже на заставку
  // Минимум 10 сцен за первые 90 секунд
  const scenesInFirst90 = scenes.filter(s => s.timestamp < 90).length;
  const isCredits = scenesInFirst90 >= 10 && creditsEndIndex >= 5;
  
  if (isCredits) {
    console.log(`🎬 Detected OPENING CREDITS: ${creditsEndIndex + 1} scenes, ends at ${lastTimestamp.toFixed(1)}s`);
  }
  
  return {
    isCredits,
    endIndex: creditsEndIndex,
    endTimestamp: lastTimestamp,
  };
}

/**
 * Детектирует финальные титры в конце видео
 * 
 * Критерии:
 * 1. Последние 30-120 секунд видео
 * 2. Много статичных или медленных сцен
 * 3. Обычно начинается после последней сцены с диалогами
 */
export function detectClosingCredits(
  scenes: FFmpegScene[],
  videoDuration: number
): { isCredits: boolean; startIndex: number; startTimestamp: number } {
  if (scenes.length < 5 || videoDuration < 120) {
    return { isCredits: false, startIndex: scenes.length, startTimestamp: videoDuration };
  }

  // Смотрим последние 120 секунд или 10% видео
  const minCreditsStart = Math.max(videoDuration - 120, videoDuration * 0.9);
  
  // Ищем начало финальных титров
  let creditsStartIndex = scenes.length;
  let startTimestamp = videoDuration;
  
  // Идём с конца
  for (let i = scenes.length - 1; i >= 0; i--) {
    const scene = scenes[i];
    
    if (scene.timestamp < minCreditsStart) {
      break;
    }
    
    // Если нашли много сцен в конце - это титры
    creditsStartIndex = i;
    startTimestamp = scene.timestamp;
  }
  
  // Проверяем что есть хотя бы 3 сцены в конце
  const scenesAtEnd = scenes.length - creditsStartIndex;
  const isCredits = scenesAtEnd >= 3;
  
  if (isCredits) {
    console.log(`🎬 Detected CLOSING CREDITS: ${scenesAtEnd} scenes, starts at ${startTimestamp.toFixed(1)}s`);
  }
  
  return {
    isCredits,
    startIndex: creditsStartIndex,
    startTimestamp,
  };
}

/**
 * Объединяет сцены заставки/титров в отдельные планы
 * 
 * ЛОГИКА:
 * 1. ЛОГОТИП (первые ~5 сек): Один план с логотипом студии
 * 2. ЗАСТАВКА (следующие 30-90 сек): Один план с титрами и актёрами
 * 3. После заставки: каждая склейка = отдельный план
 * 
 * Это соответствует реальным монтажным листам.
 */
export function mergeCreditsScenes(
  scenes: FFmpegScene[],
  videoDuration: number,
  fps: number = 24,
  options: { skipCreditsMerging?: boolean } = {}
): MergedScene[] {
  if (scenes.length === 0) {
    return [];
  }

  const result: MergedScene[] = [];
  
  // Если skipCreditsMerging = true — НЕ объединяем заставки
  // Gemini сам определит заставку по визуальному содержанию
  if (options.skipCreditsMerging) {
    console.log(`📝 Credits merging DISABLED — Gemini will detect credits visually`);
    
    // Просто конвертируем сцены в MergedScene без объединения
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const nextScene = scenes[i + 1];
      const endTimestamp = nextScene ? nextScene.timestamp : videoDuration;
      
      const endTimecode = timestampToTimecode(endTimestamp, fps);
      
      result.push({
        start_timecode: scene.timecode,
        end_timecode: endTimecode,
        start_timestamp: scene.timestamp,
        end_timestamp: endTimestamp,
        type: 'regular',
        originalScenesCount: 1,
      });
    }
    
    return result;
  }

  // Детектируем заставку
  const opening = detectOpeningCredits(scenes, videoDuration);

  // Детектируем финальные титры
  const closing = detectClosingCredits(scenes, videoDuration);
  
  let currentIndex = 0;
  
  if (opening.isCredits && opening.endIndex > 0) {
    const firstScene = scenes[0];
    
    // Ищем границу логотипа: первые 3-8 секунд (универсально)
    // Логотип обычно: статичная картинка или простая анимация логотипа студии
    let logoEndTimestamp = 5.0; // По умолчанию 5 секунд
    
    // Ищем первую сцену после 3 секунд — это начало основной заставки
    for (let i = 0; i < Math.min(opening.endIndex, 15); i++) {
      const scene = scenes[i];
      if (scene.timestamp >= 3.0 && scene.timestamp <= 8.0) {
        logoEndTimestamp = scene.timestamp;
        break;
      }
    }
    
    // Находим индекс конца логотипа
    let logoEndIndex = 0;
    for (let i = 0; i <= opening.endIndex; i++) {
      if (scenes[i].timestamp >= logoEndTimestamp) {
        logoEndIndex = i;
        break;
      }
      logoEndIndex = i;
    }
    
    const logoEndScene = scenes[logoEndIndex];
    const creditsStartScene = scenes[Math.min(logoEndIndex, opening.endIndex)];
    
    // 1. ЛОГОТИП (первые ~5 секунд)
    if (logoEndScene && logoEndScene.timestamp > 0) {
      result.push({
        start_timecode: firstScene.timecode,
        end_timecode: logoEndScene.timecode,
        start_timestamp: firstScene.timestamp,
        end_timestamp: logoEndScene.timestamp,
        type: 'opening_credits', // Используем тот же тип, промпт разберёт по времени
        originalScenesCount: logoEndIndex,
      });
      
      const logoDuration = logoEndScene.timestamp - firstScene.timestamp;
      console.log(`📦 Plan 1: LOGO (${logoDuration.toFixed(1)}s, ${logoEndIndex} FFmpeg scenes merged)`);
    }
    
    // 2. ЗАСТАВКА (от логотипа до конца opening)
    const creditsEndScene = scenes[opening.endIndex];
    const afterCreditsScene = scenes[opening.endIndex + 1];
    
    if (creditsStartScene && creditsEndScene) {
      const creditsEnd = afterCreditsScene?.timecode || formatTimecode(opening.endTimestamp + 0.5, fps);
      const creditsEndTimestamp = afterCreditsScene?.timestamp || opening.endTimestamp + 0.5;
      
      result.push({
        start_timecode: logoEndScene?.timecode || creditsStartScene.timecode,
        end_timecode: creditsEnd,
        start_timestamp: logoEndScene?.timestamp || creditsStartScene.timestamp,
        end_timestamp: creditsEndTimestamp,
        type: 'opening_credits',
        originalScenesCount: opening.endIndex - logoEndIndex,
      });
      
      const creditsDuration = creditsEndTimestamp - (logoEndScene?.timestamp || creditsStartScene.timestamp);
      console.log(`📦 Plan 2: OPENING CREDITS (${creditsDuration.toFixed(1)}s, ${opening.endIndex - logoEndIndex} FFmpeg scenes merged)`);
    }
    
    currentIndex = opening.endIndex + 1;
    console.log(`📊 Opening: ${opening.endIndex + 1} FFmpeg scenes → 2 plans (logo + credits)`);
  }
  
  // 2. Обычные сцены - каждая отдельно
  const regularEndIndex = closing.isCredits ? closing.startIndex : scenes.length;
  
  for (let i = currentIndex; i < regularEndIndex; i++) {
    const scene = scenes[i];
    const nextScene = scenes[i + 1];
    
    result.push({
      start_timecode: scene.timecode,
      end_timecode: nextScene?.timecode || formatTimecode(scene.timestamp + 2, fps),
      start_timestamp: scene.timestamp,
      end_timestamp: nextScene?.timestamp || scene.timestamp + 2,
      type: 'regular',
      originalScenesCount: 1,
    });
  }
  
  // 3. Финальные титры (если есть) - объединяем в ОДИН план
  if (closing.isCredits && closing.startIndex < scenes.length) {
    const firstClosingScene = scenes[closing.startIndex];
    
    result.push({
      start_timecode: firstClosingScene.timecode,
      end_timecode: formatTimecode(videoDuration, fps),
      start_timestamp: firstClosingScene.timestamp,
      end_timestamp: videoDuration,
      type: 'closing_credits',
      originalScenesCount: scenes.length - closing.startIndex,
    });
    
    console.log(`📦 Merged ${scenes.length - closing.startIndex} closing scenes into 1 plan`);
  }
  
  console.log(`📊 Total: ${scenes.length} FFmpeg scenes → ${result.length} merged plans`);
  
  return result;
}

/**
 * Форматирует timestamp в таймкод
 */
function formatTimecode(seconds: number, fps: number = 24): string {
  const safeFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(seconds * safeFps);
  const f = ((totalFrames % safeFps) + safeFps) % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

/**
 * Проверяет, является ли сцена частью заставки/титров
 */
export function isCreditsScene(scene: MergedScene): boolean {
  return scene.type === 'opening_credits' || scene.type === 'closing_credits';
}


