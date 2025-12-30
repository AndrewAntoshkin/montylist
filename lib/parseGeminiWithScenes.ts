import type { ParsedScene } from '@/types';

/**
 * Конвертация таймкода в секунды для сравнения
 */
function timecodeToSeconds(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  if (parts.length === 4) {
    // HH:MM:SS:FF
    return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 24;
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * ИСПРАВЛЕННЫЙ парсинг: TIMECODE matching вместо ORDER matching
 * 
 * Новая логика:
 * 1. Всегда используем ТАЙМКОДЫ GEMINI (он их видит в burn-in на видео!)
 * 2. FFmpeg сцены используем только для валидации количества
 * 
 * Причина: ORDER matching ломался когда Gemini пропускал/добавлял сцену,
 * что приводило к сдвигу всех последующих описаний.
 */
export function parseGeminiResponseWithScenes(
  geminiText: string,
  detectedScenes: Array<{ start_timecode: string; end_timecode: string }>
): ParsedScene[] {
  console.log(`\n🔍 Parsing Gemini response (${detectedScenes.length} FFmpeg scenes)...`);
  
  // Parse Gemini's response
  const { parseGeminiResponse } = require('./parseGeminiResponse');
  const geminiPlans = parseGeminiResponse(geminiText);
  
  console.log(`📊 Gemini returned ${geminiPlans.length} plans`);
  console.log(`📊 FFmpeg detected ${detectedScenes.length} scenes`);
  
  const results: ParsedScene[] = [];
  const countDiff = Math.abs(geminiPlans.length - detectedScenes.length);
  
  // НОВАЯ ЛОГИКА: Всегда доверяем таймкодам Gemini!
  // Gemini видит burn-in таймкоды в видео - это source of truth
  // FFmpeg только детектирует смену кадров, но не видит реальные таймкоды
  
  if (geminiPlans.length > 0 && geminiPlans[0].start_timecode) {
    // У Gemini есть свои таймкоды - используем их напрямую
    console.log('✅ Using GEMINI TIMECODES (source of truth from burn-in)');
    
    for (const plan of geminiPlans) {
      results.push({
        timecode: `${plan.start_timecode} - ${plan.end_timecode}`,
        start_timecode: plan.start_timecode,
        end_timecode: plan.end_timecode,
        plan_type: plan.plan_type || 'Ср.',
        description: plan.description || '',
        dialogues: plan.dialogues || 'Музыка',
      });
    }
    
    // Предупреждение если количество сильно отличается
    if (countDiff > 5) {
      console.warn(`⚠️ Large count difference: Gemini ${geminiPlans.length} vs FFmpeg ${detectedScenes.length}`);
    }
  } else {
    // Fallback: Gemini не вернул таймкоды - используем FFmpeg + ORDER matching
    console.log('⚠️ Gemini has no timecodes, falling back to FFmpeg ORDER matching');
    
    for (let i = 0; i < detectedScenes.length; i++) {
      const ffmpegScene = detectedScenes[i];
      const geminiPlan = i < geminiPlans.length ? geminiPlans[i] : null;
      
      results.push({
        timecode: `${ffmpegScene.start_timecode} - ${ffmpegScene.end_timecode}`,
        start_timecode: ffmpegScene.start_timecode,
        end_timecode: ffmpegScene.end_timecode,
        plan_type: geminiPlan?.plan_type || 'Ср.',
        description: geminiPlan?.description || '',
        dialogues: geminiPlan?.dialogues || 'Музыка',
      });
    }
  }
  
  console.log(`✅ Result: ${results.length} plans`);
  
  return results;
}

/**
 * Простая валидация полноты ответа
 */
export function validateGeminiCompleteness(
  parsedScenes: ParsedScene[],
  expectedScenes: number
): { isComplete: boolean; missing: number; warnings: string[] } {
  const warnings: string[] = [];
  const diff = Math.abs(expectedScenes - parsedScenes.length);
  
  // Допускаем расхождение ±5 планов (модель может разбить/объединить некоторые)
  const isComplete = diff <= 5;
  
  if (!isComplete) {
    warnings.push(`⚠️ Count mismatch: expected ~${expectedScenes}, got ${parsedScenes.length}`);
  }
  
  // Проверяем пустые описания
  const emptyDescriptions = parsedScenes.filter(s => !s.description || s.description.length < 5).length;
  if (emptyDescriptions > 0) {
    warnings.push(`⚠️ ${emptyDescriptions} plans have empty/short descriptions`);
  }
  
  return {
    isComplete,
    missing: Math.max(0, expectedScenes - parsedScenes.length),
    warnings,
  };
}
