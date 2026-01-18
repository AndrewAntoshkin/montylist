/**
 * Chunk Validation Module
 * 
 * Анализирует качество обработанных чанков и определяет,
 * какие нужно переобработать
 */

import { timecodeToSeconds } from './video-chunking';

export interface ChunkValidationResult {
  chunkIndex: number;
  startTimecode: string;
  endTimecode: string;
  isValid: boolean;
  issues: ChunkIssue[];
  needsRetry: boolean;
  retryReason?: string;
}

export interface ChunkIssue {
  type: 'empty_dialogues' | 'unknown_characters' | 'missing_scenes' | 'gap' | 'short_descriptions';
  severity: 'warning' | 'error';
  description: string;
  planNumbers?: number[];
}

export interface ValidationSummary {
  totalChunks: number;
  validChunks: number;
  chunksNeedingRetry: ChunkValidationResult[];
  allIssues: ChunkIssue[];
}

/**
 * Валидирует качество одного чанка
 */
export function validateChunkQuality(
  entries: any[],
  chunkStartTimecode: string,
  chunkEndTimecode: string,
  chunkIndex: number,
  expectedMinScenes: number = 5 // Минимум 5 сцен на 3 минуты
): ChunkValidationResult {
  const issues: ChunkIssue[] = [];
  
  // Фильтруем entries для этого чанка
  const chunkStartSeconds = timecodeToSeconds(chunkStartTimecode);
  const chunkEndSeconds = timecodeToSeconds(chunkEndTimecode);
  
  const chunkEntries = entries.filter(entry => {
    const entryStart = timecodeToSeconds(entry.start_timecode);
    return entryStart >= chunkStartSeconds && entryStart < chunkEndSeconds;
  });
  
  // 1. Проверка: слишком мало сцен
  if (chunkEntries.length < expectedMinScenes) {
    issues.push({
      type: 'missing_scenes',
      severity: 'error',
      description: `Только ${chunkEntries.length} сцен (ожидалось минимум ${expectedMinScenes})`,
    });
  }
  
  // 2. Проверка: пустые диалоги где должны быть
  const emptyDialoguePlans: number[] = [];
  for (const entry of chunkEntries) {
    const dialogues = (entry.dialogues || '').trim();
    const description = (entry.description || '').toLowerCase();
    
    // Если в описании есть "говорит", "отвечает", "спрашивает" но диалоги пустые
    if (
      (description.includes('говорит') || 
       description.includes('отвечает') || 
       description.includes('спрашивает') ||
       description.includes('разговаривает')) &&
      (!dialogues || dialogues === 'Музыка')
    ) {
      emptyDialoguePlans.push(entry.plan_number);
    }
  }
  
  if (emptyDialoguePlans.length > 3) {
    issues.push({
      type: 'empty_dialogues',
      severity: 'warning',
      description: `${emptyDialoguePlans.length} планов с описанием диалога, но без текста`,
      planNumbers: emptyDialoguePlans.slice(0, 10),
    });
  }
  
  // 3. Проверка: много неизвестных персонажей
  const unknownCharacterPlans: number[] = [];
  for (const entry of chunkEntries) {
    const dialogues = (entry.dialogues || '').toUpperCase();
    
    if (dialogues.includes('ЖЕНЩИНА') || 
        dialogues.includes('МУЖЧИНА') || 
        dialogues.includes('ДЕВУШКА') || 
        dialogues.includes('ПАРЕНЬ')) {
      unknownCharacterPlans.push(entry.plan_number);
    }
  }
  
  // Только предупреждение если это не начало видео (первые 2 минуты)
  if (unknownCharacterPlans.length > 5 && chunkStartSeconds > 120) {
    issues.push({
      type: 'unknown_characters',
      severity: 'warning',
      description: `${unknownCharacterPlans.length} планов с неидентифицированными персонажами`,
      planNumbers: unknownCharacterPlans.slice(0, 10),
    });
  }
  
  // 4. Проверка: слишком короткие описания
  const shortDescriptionPlans: number[] = [];
  for (const entry of chunkEntries) {
    const description = (entry.description || '').trim();
    if (description.length < 10 && description.length > 0) {
      shortDescriptionPlans.push(entry.plan_number);
    }
  }
  
  if (shortDescriptionPlans.length > chunkEntries.length * 0.3) { // Более 30% слишком короткие
    issues.push({
      type: 'short_descriptions',
      severity: 'warning',
      description: `${shortDescriptionPlans.length} планов с очень короткими описаниями`,
      planNumbers: shortDescriptionPlans.slice(0, 10),
    });
  }
  
  // 5. Проверка: большие gaps в таймкодах
  const sortedEntries = [...chunkEntries].sort((a, b) => 
    timecodeToSeconds(a.start_timecode) - timecodeToSeconds(b.start_timecode)
  );
  
  const gapPlans: number[] = [];
  for (let i = 1; i < sortedEntries.length; i++) {
    const prevEnd = timecodeToSeconds(sortedEntries[i - 1].end_timecode);
    const currStart = timecodeToSeconds(sortedEntries[i].start_timecode);
    const gap = currStart - prevEnd;
    
    // Gap более 5 секунд - это проблема
    if (gap > 5) {
      gapPlans.push(sortedEntries[i].plan_number);
    }
  }
  
  if (gapPlans.length > 3) {
    issues.push({
      type: 'gap',
      severity: 'error',
      description: `${gapPlans.length} больших разрывов (>5 сек) в таймкодах`,
      planNumbers: gapPlans.slice(0, 10),
    });
  }
  
  // Определяем нужен ли retry
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  
  const needsRetry = errorCount >= 1 || warningCount >= 3;
  
  let retryReason: string | undefined;
  if (needsRetry) {
    if (errorCount > 0) {
      retryReason = issues.find(i => i.severity === 'error')?.description;
    } else {
      retryReason = `${warningCount} warnings: ${issues.map(i => i.type).join(', ')}`;
    }
  }
  
  return {
    chunkIndex,
    startTimecode: chunkStartTimecode,
    endTimecode: chunkEndTimecode,
    isValid: !needsRetry,
    issues,
    needsRetry,
    retryReason,
  };
}

/**
 * Валидирует все чанки и возвращает summary
 */
export function validateAllChunks(
  entries: any[],
  chunkProgress: any
): ValidationSummary {
  const results: ChunkValidationResult[] = [];
  const allIssues: ChunkIssue[] = [];
  
  for (const chunk of chunkProgress.chunks) {
    if (chunk.status !== 'completed') continue;
    
    const result = validateChunkQuality(
      entries,
      chunk.startTimecode,
      chunk.endTimecode,
      chunk.index
    );
    
    results.push(result);
    allIssues.push(...result.issues);
  }
  
  const validChunks = results.filter(r => r.isValid).length;
  const chunksNeedingRetry = results.filter(r => r.needsRetry);
  
  return {
    totalChunks: results.length,
    validChunks,
    chunksNeedingRetry,
    allIssues,
  };
}

/**
 * Возвращает чанки, которые нужно переобработать (максимум 3 за раз)
 */
export function getChunksForRetry(
  validation: ValidationSummary,
  maxRetries: number = 3
): ChunkValidationResult[] {
  // Сортируем по серьёзности (сначала с errors, потом с warnings)
  const sorted = [...validation.chunksNeedingRetry].sort((a, b) => {
    const aErrors = a.issues.filter(i => i.severity === 'error').length;
    const bErrors = b.issues.filter(i => i.severity === 'error').length;
    return bErrors - aErrors;
  });
  
  return sorted.slice(0, maxRetries);
}



