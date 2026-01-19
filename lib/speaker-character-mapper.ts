/**
 * Speaker → Character Mapper V5
 * 
 * Создаёт стабильный маппинг speaker_id → character_name
 * с правилом "no jumps" (один speaker = один character).
 * 
 * Источники доказательств (по приоритету):
 * 1. ASR↔Script alignment (самый сильный)
 * 2. Face presence в окне речи (средний)
 * 3. Gemini visual hints (слабый)
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { AlignmentResult, AlignmentLink } from './asr-script-alignment';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export interface SpeakerCharacterMapping {
  speakerId: string;
  characterName: string;
  confidence: number;
  evidenceCount: number;
  sources: EvidenceSource[];
  locked: boolean;  // После lock не меняется
}

export interface EvidenceSource {
  type: 'alignment' | 'face_presence' | 'gemini_hint' | 'name_mention';
  character: string;
  weight: number;
  timestamp?: number;
}

export interface FacePresenceEvidence {
  speakerId: string;
  faceClusterId: string;
  characterName?: string;
  startMs: number;
  endMs: number;
  dominance: number;  // 0-1, насколько это лицо доминирует в окне
}

export interface MappingResult {
  mappings: Map<string, SpeakerCharacterMapping>;
  unmappedSpeakers: string[];
  conflicts: MappingConflict[];
}

export interface MappingConflict {
  speakerId: string;
  candidates: Array<{ character: string; score: number }>;
  resolution: 'majority' | 'locked' | 'unresolved';
}

// ═══════════════════════════════════════════════════════════════════════════
// КОНСТАНТЫ
// ═══════════════════════════════════════════════════════════════════════════

const EVIDENCE_WEIGHTS = {
  alignment: 1.5,       // ASR↔Script alignment — УСИЛЕН (был 1.0)
  voice_embedding: 0.9, // Voice embeddings
  face_presence: 0.7,   // Лицо в кадре во время речи
  name_mention: 0.8,    // Упоминание имени рядом
  gemini_hint: 0.3,     // Gemini сказал "кто говорит" (слабый)
};

const MIN_CONFIDENCE_TO_LOCK = 0.6;  // Снижен (был 0.7) для более агрессивной фиксации
const MIN_EVIDENCE_TO_LOCK = 2;      // Снижен (был 3) — 2 хороших совпадения = lock

// ═══════════════════════════════════════════════════════════════════════════
// ОСНОВНОЙ КЛАСС
// ═══════════════════════════════════════════════════════════════════════════

export class SpeakerCharacterMapper {
  private mappings: Map<string, SpeakerCharacterMapping> = new Map();
  private evidence: Map<string, EvidenceSource[]> = new Map();
  private conflicts: MappingConflict[] = [];
  
  constructor() {}
  
  /**
   * Добавляет доказательства из ASR↔Script alignment
   */
  addAlignmentEvidence(alignmentResult: AlignmentResult): void {
    for (const [speakerId, charVotes] of alignmentResult.speakerToCharacterVotes) {
      for (const [character, score] of charVotes) {
        this.addEvidence(speakerId, {
          type: 'alignment',
          character,
          weight: score * EVIDENCE_WEIGHTS.alignment,
        });
      }
    }
  }
  
  /**
   * Добавляет доказательства из face presence
   */
  addFacePresenceEvidence(evidence: FacePresenceEvidence[]): void {
    for (const ev of evidence) {
      if (!ev.characterName) continue;
      
      // Учитываем только если лицо доминирует (>50% времени в окне)
      if (ev.dominance < 0.5) continue;
      
      this.addEvidence(ev.speakerId, {
        type: 'face_presence',
        character: ev.characterName,
        weight: ev.dominance * EVIDENCE_WEIGHTS.face_presence,
        timestamp: ev.startMs,
      });
    }
  }
  
  /**
   * Добавляет доказательства из Gemini hints
   */
  addGeminiHints(hints: Array<{ speakerId: string; character: string; confidence: number }>): void {
    for (const hint of hints) {
      this.addEvidence(hint.speakerId, {
        type: 'gemini_hint',
        character: hint.character,
        weight: hint.confidence * EVIDENCE_WEIGHTS.gemini_hint,
      });
    }
  }
  
  /**
   * Добавляет доказательство из упоминания имени
   */
  addNameMention(speakerId: string, character: string, timestamp: number): void {
    this.addEvidence(speakerId, {
      type: 'name_mention',
      character,
      weight: EVIDENCE_WEIGHTS.name_mention,
      timestamp,
    });
  }
  
  /**
   * Строит финальный маппинг
   */
  buildMapping(): MappingResult {
    const unmappedSpeakers: string[] = [];
    
    // Для каждого speaker вычисляем лучший character
    for (const [speakerId, sources] of this.evidence) {
      // Если уже заблокирован, пропускаем
      if (this.mappings.has(speakerId) && this.mappings.get(speakerId)!.locked) {
        continue;
      }
      
      // Агрегируем голоса по character
      const charScores = new Map<string, number>();
      for (const source of sources) {
        const current = charScores.get(source.character) || 0;
        charScores.set(source.character, current + source.weight);
      }
      
      // Сортируем по score
      const sorted = Array.from(charScores.entries())
        .sort((a, b) => b[1] - a[1]);
      
      if (sorted.length === 0) {
        unmappedSpeakers.push(speakerId);
        continue;
      }
      
      const bestChar = sorted[0][0];
      const bestScore = sorted[0][1];
      const totalScore = sorted.reduce((sum, [, s]) => sum + s, 0);
      const confidence = bestScore / totalScore;
      
      // Проверяем на конфликт (второй кандидат близко)
      if (sorted.length > 1) {
        const secondScore = sorted[1][1];
        const ratio = secondScore / bestScore;
        
        if (ratio > 0.7) {
          // Конфликт!
          this.conflicts.push({
            speakerId,
            candidates: sorted.map(([char, score]) => ({ character: char, score })),
            resolution: 'unresolved',
          });
        }
      }
      
      // Создаём маппинг
      const mapping: SpeakerCharacterMapping = {
        speakerId,
        characterName: bestChar,
        confidence,
        evidenceCount: sources.length,
        sources,
        locked: confidence >= MIN_CONFIDENCE_TO_LOCK && sources.length >= MIN_EVIDENCE_TO_LOCK,
      };
      
      this.mappings.set(speakerId, mapping);
    }
    
    return {
      mappings: this.mappings,
      unmappedSpeakers,
      conflicts: this.conflicts,
    };
  }
  
  /**
   * Принудительно устанавливает маппинг (например, ручная коррекция)
   */
  forceMapping(speakerId: string, characterName: string): void {
    this.mappings.set(speakerId, {
      speakerId,
      characterName,
      confidence: 1.0,
      evidenceCount: 1,
      sources: [{ type: 'alignment', character: characterName, weight: 1.0 }],
      locked: true,
    });
  }
  
  /**
   * Получает character по speaker
   */
  getCharacter(speakerId: string): string | null {
    const mapping = this.mappings.get(speakerId);
    return mapping ? mapping.characterName : null;
  }
  
  /**
   * Проверяет правило "no jumps" — один speaker не должен менять character
   */
  validateNoJumps(): { valid: boolean; violations: string[] } {
    const violations: string[] = [];
    
    for (const [speakerId, sources] of this.evidence) {
      const characters = new Set(sources.map(s => s.character));
      
      if (characters.size > 1) {
        const mapping = this.mappings.get(speakerId);
        if (mapping && !mapping.locked) {
          violations.push(speakerId);
        }
      }
    }
    
    return {
      valid: violations.length === 0,
      violations,
    };
  }
  
  /**
   * Экспорт маппинга в простой объект
   */
  export(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [speakerId, mapping] of this.mappings) {
      result[speakerId] = mapping.characterName;
    }
    return result;
  }
  
  /**
   * Импорт маппинга из объекта (например, из БД)
   */
  import(data: Record<string, string>): void {
    for (const [speakerId, characterName] of Object.entries(data)) {
      this.forceMapping(speakerId, characterName);
    }
  }
  
  /**
   * Получает текущий маппинг как Map
   */
  getMapping(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [speakerId, mapping] of this.mappings) {
      result.set(speakerId, mapping.characterName);
    }
    return result;
  }
  
  /**
   * Устанавливает ручной маппинг (алиас для forceMapping)
   */
  setManualMapping(speakerId: string, characterName: string): void {
    this.forceMapping(speakerId, characterName);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ПРИВАТНЫЕ МЕТОДЫ
  // ═══════════════════════════════════════════════════════════════════════════
  
  private addEvidence(speakerId: string, source: EvidenceSource): void {
    if (!this.evidence.has(speakerId)) {
      this.evidence.set(speakerId, []);
    }
    this.evidence.get(speakerId)!.push(source);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Создаёт маппер и инициализирует его из alignment
 */
export function createMapperFromAlignment(
  alignmentResult: AlignmentResult
): SpeakerCharacterMapper {
  const mapper = new SpeakerCharacterMapper();
  mapper.addAlignmentEvidence(alignmentResult);
  return mapper;
}

/**
 * Быстрый маппинг speaker → character без полного пайплайна
 */
export function quickSpeakerToCharacter(
  speakerToCharacterVotes: Map<string, Map<string, number>>
): Map<string, string> {
  const result = new Map<string, string>();
  
  for (const [speakerId, charVotes] of speakerToCharacterVotes) {
    let bestChar = '';
    let bestScore = 0;
    
    for (const [char, score] of charVotes) {
      if (score > bestScore) {
        bestChar = char;
        bestScore = score;
      }
    }
    
    if (bestChar) {
      result.set(speakerId, bestChar);
    }
  }
  
  return result;
}

/**
 * Логирует статистику маппинга
 */
export function logMappingStats(result: MappingResult): void {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SPEAKER → CHARACTER MAPPING');
  console.log('═'.repeat(60));
  
  console.log(`   Mapped speakers: ${result.mappings.size}`);
  console.log(`   Unmapped speakers: ${result.unmappedSpeakers.length}`);
  console.log(`   Conflicts: ${result.conflicts.length}`);
  console.log('');
  
  for (const [speakerId, mapping] of result.mappings) {
    const lockIcon = mapping.locked ? '🔒' : '🔓';
    console.log(`   ${lockIcon} ${speakerId} → ${mapping.characterName} (conf: ${(mapping.confidence * 100).toFixed(0)}%, evidence: ${mapping.evidenceCount})`);
  }
  
  if (result.conflicts.length > 0) {
    console.log('\n   ⚠️ Conflicts:');
    for (const conflict of result.conflicts) {
      const candidates = conflict.candidates
        .slice(0, 3)
        .map(c => `${c.character}:${c.score.toFixed(1)}`)
        .join(' vs ');
      console.log(`      ${conflict.speakerId}: ${candidates}`);
    }
  }
  
  console.log('');
}
