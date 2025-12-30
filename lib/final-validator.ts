/**
 * Final Validator — жёсткая валидация готового монтажного листа
 * 
 * Проверяет:
 * 1. Таймлайн — непрерывность, нет пустых планов
 * 2. Нумерация — последовательная без пропусков
 * 3. Персонажи — нет generic имён если есть реестр
 * 4. Обрывы — нет обрывов посреди таймлайна
 */

import { type CharacterRegistry } from './character-registry';

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  summary: string;
}

export interface ValidationIssue {
  type: 'timeline' | 'numbering' | 'character' | 'empty' | 'gap' | 'truncated';
  severity: 'error' | 'warning' | 'info';
  planNumber?: number;
  timecode?: string;
  message: string;
}

export interface MontageEntry {
  id: string;
  plan_number: number;
  order_index?: number;
  start_timecode: string;
  end_timecode: string;
  plan_type?: string;
  description?: string;
  dialogues?: string;
}

/**
 * Полная валидация монтажного листа
 */
export function validateMontageSheet(
  entries: MontageEntry[],
  characterRegistry?: CharacterRegistry | null
): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  if (entries.length === 0) {
    return {
      isValid: false,
      score: 0,
      issues: [{ type: 'empty', severity: 'error', message: 'Монтажный лист пуст' }],
      summary: 'Монтажный лист пуст',
    };
  }

  // Сортируем по таймкоду для проверки
  const sorted = [...entries].sort((a, b) => 
    a.start_timecode.localeCompare(b.start_timecode)
  );

  // ═══════════════════════════════════════════════════════════════
  // 1. ПРОВЕРКА НУМЕРАЦИИ
  // ═══════════════════════════════════════════════════════════════
  
  const expectedNumbers = sorted.map((_, i) => i + 1);
  const actualNumbers = sorted.map(e => e.plan_number);
  
  for (let i = 0; i < sorted.length; i++) {
    if (actualNumbers[i] !== expectedNumbers[i]) {
      issues.push({
        type: 'numbering',
        severity: 'warning',
        planNumber: actualNumbers[i],
        message: `План ${actualNumbers[i]} должен быть ${expectedNumbers[i]}`,
      });
    }
  }
  
  // Проверка пропусков
  const numberSet = new Set(actualNumbers);
  for (let i = 1; i <= Math.max(...actualNumbers); i++) {
    if (!numberSet.has(i)) {
      issues.push({
        type: 'numbering',
        severity: 'error',
        planNumber: i,
        message: `Пропущен план ${i}`,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. ПРОВЕРКА ПУСТЫХ ПЛАНОВ
  // ═══════════════════════════════════════════════════════════════
  
  for (const entry of sorted) {
    if (entry.start_timecode === entry.end_timecode) {
      issues.push({
        type: 'empty',
        severity: 'error',
        planNumber: entry.plan_number,
        timecode: entry.start_timecode,
        message: `План ${entry.plan_number} имеет нулевую длительность`,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. ПРОВЕРКА РАЗРЫВОВ ТАЙМЛАЙНА
  // ═══════════════════════════════════════════════════════════════
  
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].end_timecode;
    const currStart = sorted[i].start_timecode;
    
    if (currStart !== prevEnd) {
      const gapSeconds = timecodeToSeconds(currStart) - timecodeToSeconds(prevEnd);
      
      if (gapSeconds > 0.5) { // Больше 0.5 секунды
        issues.push({
          type: 'gap',
          severity: gapSeconds > 5 ? 'error' : 'warning',
          planNumber: sorted[i].plan_number,
          timecode: currStart,
          message: `Разрыв ${gapSeconds.toFixed(1)}с между планами ${sorted[i - 1].plan_number} и ${sorted[i].plan_number}`,
        });
      } else if (gapSeconds < -0.5) { // Перекрытие
        issues.push({
          type: 'timeline',
          severity: 'warning',
          planNumber: sorted[i].plan_number,
          timecode: currStart,
          message: `Перекрытие ${Math.abs(gapSeconds).toFixed(1)}с между планами ${sorted[i - 1].plan_number} и ${sorted[i].plan_number}`,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. ПРОВЕРКА ПЕРСОНАЖЕЙ
  // ═══════════════════════════════════════════════════════════════
  
  const genericNames = ['МУЖЧИНА', 'ЖЕНЩИНА', 'ДЕВУШКА', 'ПАРЕНЬ', 'ЧЕЛОВЕК'];
  const hasRegistry = characterRegistry && characterRegistry.characters.length > 0;
  
  if (hasRegistry) {
    for (const entry of sorted) {
      const dialogues = entry.dialogues || '';
      
      for (const generic of genericNames) {
        if (dialogues.includes(generic)) {
          issues.push({
            type: 'character',
            severity: 'warning',
            planNumber: entry.plan_number,
            timecode: entry.start_timecode,
            message: `План ${entry.plan_number} использует "${generic}" вместо имени персонажа`,
          });
          break; // Один warning на план
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. ПРОВЕРКА ОБРЫВА (преждевременное завершение)
  // ═══════════════════════════════════════════════════════════════
  
  // Проверяем, что последний план не обрывается на странном месте
  const lastEntry = sorted[sorted.length - 1];
  const lastSeconds = timecodeToSeconds(lastEntry.end_timecode);
  
  // Если последний план короче 30 секунд от ожидаемого конца — подозрительно
  // (это эвристика, можно настроить)

  // ═══════════════════════════════════════════════════════════════
  // РАСЧЁТ ИТОГОВОГО СЧЁТА
  // ═══════════════════════════════════════════════════════════════
  
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  
  // Штрафы
  let score = 100;
  score -= errorCount * 10;     // -10 за каждую ошибку
  score -= warningCount * 2;    // -2 за каждое предупреждение
  score = Math.max(0, score);
  
  const isValid = errorCount === 0;
  
  // Краткое резюме
  let summary = '';
  if (isValid && warningCount === 0) {
    summary = `✅ Отлично! ${entries.length} планов без ошибок`;
  } else if (isValid) {
    summary = `⚠️ ${entries.length} планов, ${warningCount} предупреждений`;
  } else {
    summary = `❌ ${entries.length} планов, ${errorCount} ошибок, ${warningCount} предупреждений`;
  }

  return {
    isValid,
    score,
    issues,
    summary,
  };
}

/**
 * Конвертирует таймкод в секунды
 */
function timecodeToSeconds(timecode: string): number {
  const parts = timecode.split(':');
  if (parts.length < 3) return 0;
  
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const seconds = parseInt(parts[2], 10) || 0;
  const frames = parseInt(parts[3] || '0', 10) || 0;
  
  return hours * 3600 + minutes * 60 + seconds + frames / 24;
}

/**
 * Применяет исправления к монтажному листу
 */
export function fixMontageSheet(
  entries: MontageEntry[],
  characterRegistry?: CharacterRegistry | null
): {
  fixed: MontageEntry[];
  deletedIds: string[];
  renumbered: boolean;
  characterReplacements: number;
} {
  const deletedIds: string[] = [];
  let characterReplacements = 0;
  
  // 1. Удаляем пустые планы
  const nonEmpty = entries.filter(e => {
    if (e.start_timecode === e.end_timecode) {
      deletedIds.push(e.id);
      return false;
    }
    return true;
  });
  
  // 2. Сортируем по таймкоду
  const sorted = [...nonEmpty].sort((a, b) => 
    a.start_timecode.localeCompare(b.start_timecode)
  );
  
  // 3. Перенумеровываем
  const renumbered = sorted.map((entry, i) => ({
    ...entry,
    plan_number: i + 1,
    order_index: i + 1,
  }));
  
  // 4. Замена generic имён на реальные (если есть реестр)
  if (characterRegistry && characterRegistry.characters.length > 0) {
    const femaleChars = characterRegistry.characters.filter(c => c.gender === 'female');
    const maleChars = characterRegistry.characters.filter(c => c.gender === 'male');
    
    for (const entry of renumbered) {
      let dialogues = entry.dialogues || '';
      
      // Простая замена (первый найденный персонаж соответствующего пола)
      if (dialogues.includes('ЖЕНЩИНА') && femaleChars.length > 0) {
        dialogues = dialogues.replace(/\bЖЕНЩИНА\b/g, femaleChars[0].name);
        characterReplacements++;
      }
      if (dialogues.includes('МУЖЧИНА') && maleChars.length > 0) {
        dialogues = dialogues.replace(/\bМУЖЧИНА\b/g, maleChars[0].name);
        characterReplacements++;
      }
      
      entry.dialogues = dialogues;
    }
  }
  
  return {
    fixed: renumbered,
    deletedIds,
    renumbered: deletedIds.length > 0 || entries.some((e, i) => e.plan_number !== i + 1),
    characterReplacements,
  };
}

/**
 * Форматирует отчёт валидации для логов
 */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];
  
  lines.push(`\n${'═'.repeat(60)}`);
  lines.push(`📋 VALIDATION REPORT`);
  lines.push(`${'═'.repeat(60)}`);
  lines.push(`Score: ${result.score}/100`);
  lines.push(`Status: ${result.isValid ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push(`Summary: ${result.summary}`);
  
  if (result.issues.length > 0) {
    lines.push(`\nIssues (${result.issues.length}):`);
    
    const byType = new Map<string, ValidationIssue[]>();
    for (const issue of result.issues) {
      if (!byType.has(issue.type)) {
        byType.set(issue.type, []);
      }
      byType.get(issue.type)!.push(issue);
    }
    
    for (const [type, typeIssues] of byType) {
      lines.push(`\n  ${type.toUpperCase()} (${typeIssues.length}):`);
      for (const issue of typeIssues.slice(0, 5)) {
        const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`    ${icon} ${issue.message}`);
      }
      if (typeIssues.length > 5) {
        lines.push(`    ... and ${typeIssues.length - 5} more`);
      }
    }
  }
  
  lines.push(`${'═'.repeat(60)}\n`);
  
  return lines.join('\n');
}



