/**
 * ASR↔Script Alignment Module V5
 * 
 * Сопоставляет реплики из ASR (AssemblyAI) с репликами из сценария.
 * Использует:
 * - Fuzzy matching (Levenshtein distance)
 * - Порядковый матчинг (order-aware)
 * - Якоря (уникальные фразы) для фиксации позиций
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { ScriptLine } from './script-parser-deterministic';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export interface ASRSegment {
  text: string;
  speakerId: string;
  startMs: number;
  endMs: number;
  confidence: number;
  words?: ASRWord[];
}

export interface ASRWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speaker?: string;
}

export interface AlignmentLink {
  asrSegmentIndex: number;
  scriptLineIndex: number;
  speakerId: string;
  expectedCharacter: string;
  confidence: number;
  matchType: 'exact' | 'fuzzy' | 'anchor' | 'order';
}

export interface AlignmentResult {
  links: AlignmentLink[];
  speakerToCharacterVotes: Map<string, Map<string, number>>;
  anchorCount: number;
  totalMatched: number;
  totalUnmatched: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════════════════════════════════════

const MIN_FUZZY_SIMILARITY = 0.55;  // СНИЖЕН для лучшего покрытия (был 0.6)
const ANCHOR_SIMILARITY = 0.85;    // Сходство для якоря
const FORCED_ALIGNMENT_SIMILARITY = 0.95; // Очень высокое сходство = принудительный матч
const MAX_SCRIPT_JUMP = 20;        // Максимальный прыжок по сценарию (порядковость)

// ═══════════════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Выполняет alignment между ASR сегментами и строками сценария
 */
export function alignASRToScript(
  asrSegments: ASRSegment[],
  scriptLines: ScriptLine[]
): AlignmentResult {
  const links: AlignmentLink[] = [];
  const speakerToCharacterVotes = new Map<string, Map<string, number>>();
  
  let lastMatchedScriptIndex = -1;
  let anchorCount = 0;
  
  for (let asrIdx = 0; asrIdx < asrSegments.length; asrIdx++) {
    const asrSeg = asrSegments[asrIdx];
    const asrText = normalizeText(asrSeg.text);
    
    if (asrText.length < 3) continue;
    
    let bestMatch: {
      scriptIdx: number;
      similarity: number;
      type: 'exact' | 'fuzzy' | 'anchor' | 'order';
    } | null = null;
    
    // Ищем в окне от последнего матча (порядковость)
    const searchStart = Math.max(0, lastMatchedScriptIndex);
    const searchEnd = Math.min(scriptLines.length, lastMatchedScriptIndex + MAX_SCRIPT_JUMP + 1);
    
    // Сначала ищем в порядковом окне
    for (let scriptIdx = searchStart; scriptIdx < searchEnd; scriptIdx++) {
      const scriptLine = scriptLines[scriptIdx];
      const scriptText = normalizeText(scriptLine.text);
      
      if (scriptText.length < 3) continue;
      
      const similarity = calculateSimilarity(asrText, scriptText);
      
      // Принудительный матч для очень высокого сходства (>95%) - сразу фиксируем
      if (similarity >= FORCED_ALIGNMENT_SIMILARITY) {
        bestMatch = { scriptIdx, similarity, type: 'exact' };
        break; // Прерываем поиск - это точный матч
      } else if (similarity >= ANCHOR_SIMILARITY) {
        // Это якорь!
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { scriptIdx, similarity, type: 'anchor' };
        }
      } else if (similarity >= MIN_FUZZY_SIMILARITY) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { scriptIdx, similarity, type: 'fuzzy' };
        }
      }
    }
    
    // Если не нашли в окне, ищем по всему сценарию (для якорей)
    if (!bestMatch || bestMatch.similarity < ANCHOR_SIMILARITY) {
      for (let scriptIdx = 0; scriptIdx < scriptLines.length; scriptIdx++) {
        if (scriptIdx >= searchStart && scriptIdx < searchEnd) continue; // Уже проверили
        
        const scriptLine = scriptLines[scriptIdx];
        const scriptText = normalizeText(scriptLine.text);
        
        if (scriptText.length < 3) continue;
        
        const similarity = calculateSimilarity(asrText, scriptText);
        
        if (similarity >= ANCHOR_SIMILARITY) {
          bestMatch = { scriptIdx, similarity, type: 'anchor' };
          break; // Нашли якорь вне окна
        }
      }
    }
    
    // Если нашли матч, добавляем link
    if (bestMatch && bestMatch.similarity >= MIN_FUZZY_SIMILARITY) {
      const scriptLine = scriptLines[bestMatch.scriptIdx];
      
      links.push({
        asrSegmentIndex: asrIdx,
        scriptLineIndex: bestMatch.scriptIdx,
        speakerId: asrSeg.speakerId,
        expectedCharacter: scriptLine.character,
        confidence: bestMatch.similarity,
        matchType: bestMatch.type,
      });
      
      // Голосуем за speaker → character
      if (!speakerToCharacterVotes.has(asrSeg.speakerId)) {
        speakerToCharacterVotes.set(asrSeg.speakerId, new Map());
      }
      const charVotes = speakerToCharacterVotes.get(asrSeg.speakerId)!;
      const currentVotes = charVotes.get(scriptLine.character) || 0;
      charVotes.set(scriptLine.character, currentVotes + bestMatch.similarity);
      
      lastMatchedScriptIndex = bestMatch.scriptIdx;
      
      if (bestMatch.type === 'anchor') anchorCount++;
    }
  }
  
  return {
    links,
    speakerToCharacterVotes,
    anchorCount,
    totalMatched: links.length,
    totalUnmatched: asrSegments.length - links.length,
  };
}

/**
 * Группирует ASR слова в сегменты по speaker
 */
export function groupWordsIntoSegments(words: ASRWord[]): ASRSegment[] {
  if (words.length === 0) return [];
  
  const segments: ASRSegment[] = [];
  let currentSegment: ASRSegment | null = null;
  
  for (const word of words) {
    // Пропускаем слова без текста
    if (!word.text) continue;
    
    const speaker = word.speaker || 'UNKNOWN';
    
    if (!currentSegment || currentSegment.speakerId !== speaker) {
      // Завершаем текущий сегмент
      if (currentSegment && currentSegment.text?.trim()) {
        segments.push(currentSegment);
      }
      
      // Начинаем новый
      currentSegment = {
        text: word.text || '',
        speakerId: speaker,
        startMs: word.startMs,
        endMs: word.endMs,
        confidence: word.confidence,
        words: [word],
      };
    } else {
      // Добавляем к текущему
      currentSegment.text += ' ' + (word.text || '');
      currentSegment.endMs = word.endMs;
      currentSegment.words?.push(word);
    }
  }
  
  // Добавляем последний сегмент
  if (currentSegment && currentSegment.text.trim()) {
    segments.push(currentSegment);
  }
  
  return segments;
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Нормализует текст для сравнения
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»""'']/g, '"')
    .replace(/[—–-]/g, '-')
    .replace(/[!?,.:;…]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Вычисляет сходство между двумя строками (0-1)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  // Для коротких строк используем Levenshtein
  if (a.length < 50 && b.length < 50) {
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - (distance / maxLen);
  }
  
  // Для длинных строк используем n-gram similarity
  return ngramSimilarity(a, b, 3);
}

/**
 * Расстояние Левенштейна
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[a.length][b.length];
}

/**
 * N-gram similarity (Jaccard)
 */
function ngramSimilarity(a: string, b: string, n: number): number {
  const ngramsA = getNgrams(a, n);
  const ngramsB = getNgrams(b, n);
  
  const setA = new Set(ngramsA);
  const setB = new Set(ngramsB);
  
  let intersection = 0;
  for (const ngram of setA) {
    if (setB.has(ngram)) intersection++;
  }
  
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  
  return intersection / union;
}

/**
 * Разбивает строку на n-грамы
 */
function getNgrams(text: string, n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.push(text.substring(i, i + n));
  }
  return ngrams;
}

/**
 * Находит лучшие якоря в alignment
 */
export function findBestAnchors(
  links: AlignmentLink[],
  minConfidence: number = 0.85
): AlignmentLink[] {
  return links
    .filter(l => l.confidence >= minConfidence && l.matchType === 'anchor')
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Проверяет порядковость alignment (нет "прыжков назад")
 */
export function validateAlignmentOrder(links: AlignmentLink[]): {
  isValid: boolean;
  violations: number[];
} {
  const violations: number[] = [];
  let lastScriptIndex = -1;
  
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (link.scriptLineIndex < lastScriptIndex) {
      violations.push(i);
    } else {
      lastScriptIndex = link.scriptLineIndex;
    }
  }
  
  return {
    isValid: violations.length === 0,
    violations,
  };
}
