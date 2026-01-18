/**
 * Speech Segment Deduplication V5
 * 
 * Удаляет дублирующиеся речевые сегменты в зонах overlap между чанками.
 * Работает НА УРОВНЕ speech_segments (до сборки montage_entries).
 * 
 * Критерии дубликата:
 * - Близость таймингов (±1 сек)
 * - Похожесть текста (>80%)
 * - Тот же speaker
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export interface SpeechSegment {
  id: string;
  chunkId: string;
  speakerId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isDuplicate?: boolean;
  duplicateOf?: string;
}

export interface ChunkInfo {
  chunkId: string;
  startMs: number;  // Глобальный старт чанка
  endMs: number;    // Глобальный конец чанка
  overlapMs: number; // Размер overlap с предыдущим
}

export interface DedupResult {
  segments: SpeechSegment[];
  removedCount: number;
  duplicatePairs: Array<{ kept: string; removed: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════════════════════════════════════

const TIMING_TOLERANCE_MS = 1000;   // ±1 секунда для совпадения таймингов
const TEXT_SIMILARITY_THRESHOLD = 0.8;  // 80% сходство текста
const PREFER_LONGER_SEGMENT = true;  // Предпочитать более длинный сегмент

// ═══════════════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Удаляет дубликаты из массива сегментов
 */
export function deduplicateSegments(
  segments: SpeechSegment[],
  chunks?: ChunkInfo[]
): DedupResult {
  if (segments.length === 0) {
    return { segments: [], removedCount: 0, duplicatePairs: [] };
  }
  
  // Сортируем по времени
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  
  const duplicatePairs: Array<{ kept: string; removed: string }> = [];
  const toRemove = new Set<string>();
  
  // Проходим по парам и ищем дубликаты
  for (let i = 0; i < sorted.length; i++) {
    if (toRemove.has(sorted[i].id)) continue;
    
    for (let j = i + 1; j < sorted.length; j++) {
      if (toRemove.has(sorted[j].id)) continue;
      
      const segA = sorted[i];
      const segB = sorted[j];
      
      // Если сегменты слишком далеко по времени, прекращаем
      if (segB.startMs - segA.endMs > TIMING_TOLERANCE_MS * 2) {
        break;
      }
      
      // Проверяем на дубликат
      if (isDuplicate(segA, segB)) {
        // Выбираем какой оставить
        const kept = chooseBetterSegment(segA, segB, chunks);
        const removed = kept.id === segA.id ? segB : segA;
        
        toRemove.add(removed.id);
        removed.isDuplicate = true;
        removed.duplicateOf = kept.id;
        
        duplicatePairs.push({
          kept: kept.id,
          removed: removed.id,
        });
      }
    }
  }
  
  // Фильтруем дубликаты
  const dedupedSegments = sorted.filter(seg => !toRemove.has(seg.id));
  
  return {
    segments: dedupedSegments,
    removedCount: toRemove.size,
    duplicatePairs,
  };
}

/**
 * Дедупликация с учётом overlap зон
 */
export function deduplicateInOverlapZones(
  segments: SpeechSegment[],
  chunks: ChunkInfo[]
): DedupResult {
  if (chunks.length < 2) {
    return { segments, removedCount: 0, duplicatePairs: [] };
  }
  
  const duplicatePairs: Array<{ kept: string; removed: string }> = [];
  const toRemove = new Set<string>();
  
  // Для каждой пары соседних чанков
  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1];
    const currChunk = chunks[i];
    
    // Определяем overlap зону
    const overlapStart = currChunk.startMs;
    const overlapEnd = currChunk.startMs + currChunk.overlapMs;
    
    // Находим сегменты в overlap зоне
    const overlapSegments = segments.filter(seg =>
      !toRemove.has(seg.id) &&
      seg.startMs >= overlapStart - TIMING_TOLERANCE_MS &&
      seg.startMs <= overlapEnd + TIMING_TOLERANCE_MS
    );
    
    // Группируем по chunkId
    const prevChunkSegments = overlapSegments.filter(s => s.chunkId === prevChunk.chunkId);
    const currChunkSegments = overlapSegments.filter(s => s.chunkId === currChunk.chunkId);
    
    // Ищем дубликаты между чанками
    for (const segPrev of prevChunkSegments) {
      for (const segCurr of currChunkSegments) {
        if (isDuplicate(segPrev, segCurr)) {
          // Предпочитаем сегмент дальше от края чанка
          const prevDistFromEdge = prevChunk.endMs - segPrev.endMs;
          const currDistFromEdge = segCurr.startMs - currChunk.startMs;
          
          const kept = prevDistFromEdge > currDistFromEdge ? segPrev : segCurr;
          const removed = kept.id === segPrev.id ? segCurr : segPrev;
          
          toRemove.add(removed.id);
          removed.isDuplicate = true;
          removed.duplicateOf = kept.id;
          
          duplicatePairs.push({
            kept: kept.id,
            removed: removed.id,
          });
        }
      }
    }
  }
  
  const dedupedSegments = segments.filter(seg => !toRemove.has(seg.id));
  
  return {
    segments: dedupedSegments,
    removedCount: toRemove.size,
    duplicatePairs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяет, являются ли два сегмента дубликатами
 */
function isDuplicate(a: SpeechSegment, b: SpeechSegment): boolean {
  // Должен быть тот же speaker
  if (a.speakerId !== b.speakerId) return false;
  
  // Проверяем близость таймингов
  const timingClose = 
    Math.abs(a.startMs - b.startMs) <= TIMING_TOLERANCE_MS &&
    Math.abs(a.endMs - b.endMs) <= TIMING_TOLERANCE_MS;
  
  if (!timingClose) return false;
  
  // Проверяем похожесть текста
  const textSimilarity = calculateTextSimilarity(a.text, b.text);
  
  return textSimilarity >= TEXT_SIMILARITY_THRESHOLD;
}

/**
 * Выбирает лучший сегмент для сохранения
 */
function chooseBetterSegment(
  a: SpeechSegment,
  b: SpeechSegment,
  chunks?: ChunkInfo[]
): SpeechSegment {
  // Если есть информация о чанках, предпочитаем сегмент дальше от края
  if (chunks) {
    const chunkA = chunks.find(c => c.chunkId === a.chunkId);
    const chunkB = chunks.find(c => c.chunkId === b.chunkId);
    
    if (chunkA && chunkB) {
      const distA = Math.min(a.startMs - chunkA.startMs, chunkA.endMs - a.endMs);
      const distB = Math.min(b.startMs - chunkB.startMs, chunkB.endMs - b.endMs);
      
      if (distA > distB + 500) return a;
      if (distB > distA + 500) return b;
    }
  }
  
  // Предпочитаем более высокую confidence
  if (Math.abs(a.confidence - b.confidence) > 0.1) {
    return a.confidence > b.confidence ? a : b;
  }
  
  // Предпочитаем более длинный текст
  if (PREFER_LONGER_SEGMENT) {
    return a.text.length >= b.text.length ? a : b;
  }
  
  // По умолчанию берём первый
  return a;
}

/**
 * Вычисляет сходство текстов (0-1)
 */
function calculateTextSimilarity(textA: string, textB: string): number {
  const a = normalizeText(textA);
  const b = normalizeText(textB);
  
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  // Используем коэффициент Сёренсена-Дайса на словах
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  return (2 * intersection) / (wordsA.size + wordsB.size);
}

/**
 * Нормализует текст для сравнения
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»""'']/g, '')
    .replace(/[!?,.:;…\-—]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Конвертирует локальное время чанка в глобальное
 */
export function localToGlobalTime(
  localMs: number,
  chunkStartMs: number
): number {
  return chunkStartMs + localMs;
}

/**
 * Логирует результаты дедупликации
 */
export function logDedupStats(result: DedupResult): void {
  console.log('\n' + '═'.repeat(60));
  console.log('🔄 SPEECH SEGMENT DEDUPLICATION');
  console.log('═'.repeat(60));
  console.log(`   Total segments: ${result.segments.length + result.removedCount}`);
  console.log(`   Removed duplicates: ${result.removedCount}`);
  console.log(`   Final segments: ${result.segments.length}`);
  
  if (result.duplicatePairs.length > 0 && result.duplicatePairs.length <= 10) {
    console.log('   Duplicate pairs:');
    for (const pair of result.duplicatePairs) {
      console.log(`      ${pair.removed} → kept: ${pair.kept}`);
    }
  }
  console.log('');
}
