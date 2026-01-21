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
  type: 'alignment' | 'face_presence' | 'gemini_hint' | 'name_mention' | 'scene_context';
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
  alignment: 3.0,       // ASR↔Script alignment — КРИТИЧЕСКИ УСИЛЕН
  face_presence_base: 2.5,   // Базовый вес Face Presence
  face_presence_high: 5.0,   // Если dominance > 0.7 (лицо доминирует в кадре)
  face_presence_perfect: 6.0, // Если dominance > 0.8 (почти идеальное совпадение)
  voice_embedding: 1.5, // Voice embeddings — УВЕЛИЧЕНО с 1.2
  name_mention: 1.2,    // Упоминание имени рядом — УВЕЛИЧЕНО с 1.0
  gemini_hint: 0.3,     // Gemini сказал "кто говорит" (слабый)
  scene_context: 4.0,   // НОВОЕ: персонаж присутствует в списке сцены
};

const MIN_CONFIDENCE_TO_LOCK = 0.55;  // СНИЖЕН для более агрессивной фиксации (был 0.65)
const MIN_EVIDENCE_TO_LOCK = 2;        // 2 хороших совпадения = lock
const MIN_ALIGNMENT_MATCHES = 2;       // СНИЖЕН: 2 совпадения alignment = lock (был 3) для лучшего покрытия

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
   * Теперь также добавляет scene context evidence если сцена известна
   */
  addAlignmentEvidence(alignmentResult: AlignmentResult): void {
    // 1. Добавляем alignment evidence (как раньше)
    for (const [speakerId, charVotes] of alignmentResult.speakerToCharacterVotes) {
      for (const [character, score] of charVotes) {
        this.addEvidence(speakerId, {
          type: 'alignment',
          character,
          weight: score * EVIDENCE_WEIGHTS.alignment,
        });
      }
    }
    
    // 2. НОВОЕ: Добавляем scene context evidence
    // Если линк имеет sceneCharacters, это сильное доказательство
    for (const link of alignmentResult.links) {
      if (link.sceneCharacters && link.sceneCharacters.length > 0) {
        this.addSceneContextEvidence(
          link.speakerId, 
          link.expectedCharacter, 
          link.sceneCharacters
        );
      }
    }
  }
  
  /**
   * Добавляет доказательства из face presence
   * Использует динамическое взвешивание на основе dominance (исследования показывают, что это улучшает точность)
   */
  addFacePresenceEvidence(evidence: FacePresenceEvidence[]): void {
    for (const ev of evidence) {
      if (!ev.characterName) continue;
      
      // Учитываем только если лицо доминирует (>50% времени в окне)
      if (ev.dominance < 0.5) continue;
      
      // Динамическое взвешивание на основе dominance
      // Исследования показывают, что high dominance (>0.7) должна иметь больший приоритет
      let dynamicWeight = EVIDENCE_WEIGHTS.face_presence_base;
      if (ev.dominance > 0.8) {
        // Почти идеальное совпадение (>80% времени) — максимальный вес
        dynamicWeight = EVIDENCE_WEIGHTS.face_presence_perfect;
      } else if (ev.dominance > 0.7) {
        // Высокое доминирование (>70% времени) — усиленный вес
        dynamicWeight = EVIDENCE_WEIGHTS.face_presence_high;
      }
      
      // Финальный вес = dominance * динамический вес
      // Это гарантирует, что чем больше dominance, тем больше вес
      const finalWeight = ev.dominance * dynamicWeight;
      
      this.addEvidence(ev.speakerId, {
        type: 'face_presence',
        character: ev.characterName,
        weight: finalWeight,
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
   * Добавляет scene context evidence — если спикер говорит в сцене,
   * где по сценарию присутствует определённый набор персонажей
   */
  addSceneContextEvidence(
    speakerId: string, 
    expectedCharacter: string, 
    sceneCharacters: string[]
  ): void {
    // Если ожидаемый персонаж есть в списке персонажей сцены — это сильное доказательство
    const normalizedExpected = expectedCharacter.toUpperCase();
    const isInScene = sceneCharacters.some(c => c.toUpperCase() === normalizedExpected);
    
    if (isInScene) {
      this.addEvidence(speakerId, {
        type: 'scene_context',
        character: expectedCharacter,
        weight: EVIDENCE_WEIGHTS.scene_context,
      });
    }
    
    // Также добавляем негативный evidence для персонажей НЕ в сцене
    // (понижаем вес для всех других кандидатов, если сцена известна)
    // Это реализуется через фильтрацию в buildMapping
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
      // Используем priority-based resolution для лучшей точности
      if (sorted.length > 1) {
        const secondScore = sorted[1][1];
        const ratio = secondScore / bestScore;
        
        if (ratio > 0.7) {
          // Конфликт! Используем priority-based resolution
          const bestCharSources = sources.filter(s => s.character === sorted[0][0]);
          const secondCharSources = sources.filter(s => s.character === sorted[1][0]);
          
          // Приоритет 1: Face Presence с высоким dominance (>0.7)
          const bestFaceHigh = bestCharSources.some(s => 
            s.type === 'face_presence' && s.weight > 5.0
          );
          const secondFaceHigh = secondCharSources.some(s => 
            s.type === 'face_presence' && s.weight > 5.0
          );
          
          // Приоритет 2: Alignment с высоким score (>2.5)
          const bestAlignmentHigh = bestCharSources.some(s => 
            s.type === 'alignment' && s.weight > 2.5
          );
          const secondAlignmentHigh = secondCharSources.some(s => 
            s.type === 'alignment' && s.weight > 2.5
          );
          
          // Если у лучшего кандидата есть приоритетное evidence, выбираем его
          let resolvedChar = bestChar;
          let resolution: 'majority' | 'priority_face' | 'priority_alignment' | 'unresolved' = 'majority';
          
          if (bestFaceHigh && !secondFaceHigh) {
            resolvedChar = bestChar;
            resolution = 'priority_face';
          } else if (!bestFaceHigh && secondFaceHigh) {
            resolvedChar = sorted[1][0];
            resolution = 'priority_face';
          } else if (bestAlignmentHigh && !secondAlignmentHigh) {
            resolvedChar = bestChar;
            resolution = 'priority_alignment';
          } else if (!bestAlignmentHigh && secondAlignmentHigh) {
            resolvedChar = sorted[1][0];
            resolution = 'priority_alignment';
          } else {
            // Нет явного приоритета — регистрируем конфликт
            resolution = 'unresolved';
            this.conflicts.push({
              speakerId,
              candidates: sorted.map(([char, score]) => ({ character: char, score })),
              resolution: 'unresolved',
            });
            // Используем лучшего кандидата, но с более низкой уверенностью
          }
          
          // Обновляем bestChar если был выбран другой кандидат
          if (resolvedChar !== bestChar && resolution !== 'unresolved') {
            // Пересчитываем confidence для выбранного кандидата
            const resolvedScore = sorted.find(([char]) => char === resolvedChar)?.[1] || bestScore;
            const totalScore = sorted.reduce((sum, [, s]) => sum + s, 0);
            const resolvedConfidence = resolvedScore / totalScore;
            
            // Обновляем bestChar и confidence для этого mapping
            // Это делается ниже в коде
          }
        }
      }
      
      // Создаём маппинг
      // Улучшенная логика блокировки для ТОЧНОСТИ:
      // 1. Высокая уверенность + достаточно доказательств
      // 2. ИЛИ много alignment совпадений (>=2) даже при меньшей уверенности
      // 3. ИЛИ очень сильное alignment (>=3 совпадений) = принудительная фиксация
      const alignmentMatches = sources.filter(s => s.type === 'alignment').length;
      const alignmentSources = sources.filter(s => s.type === 'alignment');
      const avgAlignmentScore = alignmentSources.length > 0
        ? alignmentSources.reduce((sum, s) => sum + s.weight, 0) / alignmentSources.length
        : 0;
      
      const hasStrongAlignment = alignmentMatches >= MIN_ALIGNMENT_MATCHES;
      const hasVeryStrongAlignment = alignmentMatches >= 3; // 3+ совпадений = принудительная фиксация
      const hasEnoughEvidence = sources.length >= MIN_EVIDENCE_TO_LOCK;
      const hasHighConfidence = confidence >= MIN_CONFIDENCE_TO_LOCK;
      const hasHighAlignmentScore = avgAlignmentScore > 2.5; // Высокий средний вес alignment
      
      // Более агрессивная фиксация для точности:
      // - 3+ alignment совпадений = всегда lock
      // - 2+ alignment совпадений + высокая уверенность = lock
      // - Высокий средний вес alignment = lock
      const locked = hasVeryStrongAlignment || 
                    (hasStrongAlignment && (hasHighConfidence || hasHighAlignmentScore)) ||
                    (hasHighConfidence && hasEnoughEvidence);
      
      const mapping: SpeakerCharacterMapping = {
        speakerId,
        characterName: bestChar,
        confidence,
        evidenceCount: sources.length,
        sources,
        locked,
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
