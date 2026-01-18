/**
 * Face Presence Detector V5
 * 
 * Определяет присутствие лиц в окне речи с 3 состояниями:
 * - ONSCREEN: доминирующее лицо в кадре
 * - OFFSCREEN: лиц нет (ЗК/ГЗК)
 * - AMBIGUOUS: несколько лиц / качество низкое
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { FaceCluster } from './face-types';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export type PresenceStatus = 'ONSCREEN' | 'OFFSCREEN' | 'AMBIGUOUS';

export interface FacePresenceResult {
  status: PresenceStatus;
  dominantFace?: string;          // clusterId доминирующего лица
  dominantCharacter?: string;     // characterName если известен
  dominance: number;              // 0-1, насколько лицо доминирует
  facesInWindow: string[];        // Все лица в окне
  confidence: number;             // Общая уверенность
}

export interface SpeechWindow {
  startMs: number;
  endMs: number;
  speakerId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════════════════════════════════════

const DOMINANCE_THRESHOLD = 0.65;  // Лицо должно занимать >65% времени для ONSCREEN
const AMBIGUOUS_THRESHOLD = 0.4;   // <40% = AMBIGUOUS
const MIN_FACE_APPEARANCES = 2;    // Минимум появлений для учёта

// ═══════════════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Определяет присутствие лиц в окне речи
 */
export function detectFacePresence(
  speechWindow: SpeechWindow,
  faceClusters: FaceCluster[],
  faceToCharacter?: Map<string, string>
): FacePresenceResult {
  const windowDuration = speechWindow.endMs - speechWindow.startMs;
  
  if (windowDuration <= 0 || faceClusters.length === 0) {
    return {
      status: 'OFFSCREEN',
      dominance: 0,
      facesInWindow: [],
      confidence: 0.5,
    };
  }
  
  // Находим все лица, которые появлялись в окне речи
  const facesInWindow: Array<{ clusterId: string; duration: number; appearances: number }> = [];
  
  for (const cluster of faceClusters) {
    let totalDuration = 0;
    let appearances = 0;
    
    for (const face of cluster.faces) {
      const faceTimeMs = face.timestamp * 1000;
      
      // Проверяем, попадает ли это появление в окно речи
      if (faceTimeMs >= speechWindow.startMs && faceTimeMs <= speechWindow.endMs) {
        // Предполагаем, что каждое появление длится ~1 секунду (frameInterval)
        totalDuration += 1000;
        appearances++;
      }
    }
    
    if (appearances >= MIN_FACE_APPEARANCES) {
      facesInWindow.push({
        clusterId: cluster.clusterId,
        duration: Math.min(totalDuration, windowDuration),
        appearances,
      });
    }
  }
  
  // Нет лиц в окне
  if (facesInWindow.length === 0) {
    return {
      status: 'OFFSCREEN',
      dominance: 0,
      facesInWindow: [],
      confidence: 0.8,
    };
  }
  
  // Сортируем по длительности присутствия
  facesInWindow.sort((a, b) => b.duration - a.duration);
  
  const dominantFace = facesInWindow[0];
  const dominance = dominantFace.duration / windowDuration;
  
  // Определяем статус
  let status: PresenceStatus;
  let confidence: number;
  
  if (dominance >= DOMINANCE_THRESHOLD) {
    status = 'ONSCREEN';
    confidence = 0.85;
  } else if (facesInWindow.length > 1 || dominance < AMBIGUOUS_THRESHOLD) {
    status = 'AMBIGUOUS';
    confidence = 0.5;
  } else {
    // Одно лицо, но не доминирует достаточно
    status = 'AMBIGUOUS';
    confidence = 0.6;
  }
  
  // Получаем characterName если есть маппинг
  let dominantCharacter: string | undefined;
  if (faceToCharacter) {
    dominantCharacter = faceToCharacter.get(dominantFace.clusterId);
  }
  
  return {
    status,
    dominantFace: dominantFace.clusterId,
    dominantCharacter,
    dominance,
    facesInWindow: facesInWindow.map(f => f.clusterId),
    confidence,
  };
}

/**
 * Определяет, говорит ли персонаж "за кадром"
 */
export function isOffscreen(
  speakerId: string,
  speakerToCharacter: Map<string, string>,
  facePresence: FacePresenceResult
): boolean {
  // Если нет лиц — точно за кадром
  if (facePresence.status === 'OFFSCREEN') {
    return true;
  }
  
  // Если AMBIGUOUS — возможно за кадром
  if (facePresence.status === 'AMBIGUOUS') {
    return true; // Консервативно считаем за кадром
  }
  
  // ONSCREEN — проверяем, совпадает ли говорящий с лицом в кадре
  const speakerCharacter = speakerToCharacter.get(speakerId);
  
  if (!speakerCharacter) {
    // Не знаем кто говорит — не можем определить
    return false;
  }
  
  if (facePresence.dominantCharacter) {
    // Если говорящий не в кадре — за кадром
    return speakerCharacter !== facePresence.dominantCharacter;
  }
  
  // Не можем определить
  return false;
}

/**
 * Batch обработка: определяет presence для всех speech windows
 */
export function detectFacePresenceBatch(
  speechWindows: SpeechWindow[],
  faceClusters: FaceCluster[],
  faceToCharacter?: Map<string, string>
): Map<number, FacePresenceResult> {
  const results = new Map<number, FacePresenceResult>();
  
  for (let i = 0; i < speechWindows.length; i++) {
    results.set(i, detectFacePresence(speechWindows[i], faceClusters, faceToCharacter));
  }
  
  return results;
}

/**
 * Создаёт маппинг face → character на основе частоты совместного появления
 */
export function buildFaceToCharacterMap(
  faceClusters: FaceCluster[],
  speakerToCharacter: Map<string, string>,
  speechSegments: Array<{ speakerId: string; startMs: number; endMs: number }>
): Map<string, string> {
  const faceToCharacter = new Map<string, string>();
  const faceCharacterVotes = new Map<string, Map<string, number>>();
  
  // Для каждого speech segment
  for (const segment of speechSegments) {
    const character = speakerToCharacter.get(segment.speakerId);
    if (!character) continue;
    
    // Находим лица в этом сегменте
    for (const cluster of faceClusters) {
      let appearancesInSegment = 0;
      
      for (const face of cluster.faces) {
        const faceTimeMs = face.timestamp * 1000;
        if (faceTimeMs >= segment.startMs && faceTimeMs <= segment.endMs) {
          appearancesInSegment++;
        }
      }
      
      if (appearancesInSegment >= MIN_FACE_APPEARANCES) {
        // Голосуем
        if (!faceCharacterVotes.has(cluster.clusterId)) {
          faceCharacterVotes.set(cluster.clusterId, new Map());
        }
        const votes = faceCharacterVotes.get(cluster.clusterId)!;
        const current = votes.get(character) || 0;
        votes.set(character, current + appearancesInSegment);
      }
    }
  }
  
  // Выбираем победителя для каждого лица
  for (const [clusterId, votes] of faceCharacterVotes) {
    let bestChar = '';
    let bestScore = 0;
    
    for (const [char, score] of votes) {
      if (score > bestScore) {
        bestChar = char;
        bestScore = score;
      }
    }
    
    if (bestChar) {
      faceToCharacter.set(clusterId, bestChar);
    }
  }
  
  return faceToCharacter;
}

/**
 * Форматирует статус для отображения
 */
export function formatPresenceStatus(status: PresenceStatus): string {
  switch (status) {
    case 'ONSCREEN':
      return '';
    case 'OFFSCREEN':
      return ' ЗК';
    case 'AMBIGUOUS':
      return ' (?)';
  }
}

/**
 * Логирует статистику face presence
 */
export function logFacePresenceStats(
  results: Map<number, FacePresenceResult>
): void {
  let onscreen = 0;
  let offscreen = 0;
  let ambiguous = 0;
  
  for (const result of results.values()) {
    switch (result.status) {
      case 'ONSCREEN': onscreen++; break;
      case 'OFFSCREEN': offscreen++; break;
      case 'AMBIGUOUS': ambiguous++; break;
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('👤 FACE PRESENCE DETECTION');
  console.log('═'.repeat(60));
  console.log(`   Total speech windows: ${results.size}`);
  console.log(`   ONSCREEN: ${onscreen} (${(onscreen / results.size * 100).toFixed(1)}%)`);
  console.log(`   OFFSCREEN: ${offscreen} (${(offscreen / results.size * 100).toFixed(1)}%)`);
  console.log(`   AMBIGUOUS: ${ambiguous} (${(ambiguous / results.size * 100).toFixed(1)}%)`);
  console.log('');
}
