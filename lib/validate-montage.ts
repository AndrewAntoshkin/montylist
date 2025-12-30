import { timecodeToSeconds } from './video-chunking';

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    totalScenes: number;
    timelineGaps: number;
    duplicates: number;
    invalidTimecodes: number;
    missingDialogs: number;
    emptyDescriptions: number;
  };
}

/**
 * Validate montage entries after finalization
 */
export function validateMontageEntries(entries: any[]): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const stats = {
    totalScenes: entries.length,
    timelineGaps: 0,
    duplicates: 0,
    invalidTimecodes: 0,
    missingDialogs: 0,
    emptyDescriptions: 0,
  };

  if (entries.length === 0) {
    errors.push('No entries found');
    return { isValid: false, warnings, errors, stats };
  }

  // 1. Check timecode format and validity
  console.log('📊 Validating timecode format...');
  entries.forEach((entry, index) => {
    const startTC = entry.start_timecode;
    const endTC = entry.end_timecode;
    
    // Check format ЧЧ:ММ:СС:КК
    const timecodeRegex = /^\d{2}:\d{2}:\d{2}:\d{2}$/;
    
    if (!timecodeRegex.test(startTC)) {
      errors.push(`Entry ${index + 1}: Invalid start timecode format: ${startTC}`);
      stats.invalidTimecodes++;
    }
    
    if (!timecodeRegex.test(endTC)) {
      errors.push(`Entry ${index + 1}: Invalid end timecode format: ${endTC}`);
      stats.invalidTimecodes++;
    }
    
    // Check that end > start
    try {
      const startSec = timecodeToSeconds(startTC);
      const endSec = timecodeToSeconds(endTC);
      
      if (endSec <= startSec) {
        errors.push(`Entry ${index + 1}: End timecode (${endTC}) is not after start (${startTC})`);
      }
    } catch (e) {
      errors.push(`Entry ${index + 1}: Failed to parse timecodes: ${startTC} - ${endTC}`);
    }
  });

  // 2. Check for timeline continuity (gaps and overlaps)
  console.log('📊 Validating timeline continuity...');
  for (let i = 0; i < entries.length - 1; i++) {
    const current = entries[i];
    const next = entries[i + 1];
    
    try {
      const currentEnd = timecodeToSeconds(current.end_timecode);
      const nextStart = timecodeToSeconds(next.start_timecode);
      
      const gap = nextStart - currentEnd;
      
      // Gap more than 30 seconds - warning
      if (gap > 30) {
        warnings.push(`Gap of ${gap.toFixed(1)}s between scene ${i + 1} (${current.end_timecode}) and scene ${i + 2} (${next.start_timecode})`);
        stats.timelineGaps++;
      }
      
      // Overlap (next starts before current ends) - could be valid for cuts
      if (gap < -1) {
        warnings.push(`Overlap of ${Math.abs(gap).toFixed(1)}s: scene ${i + 1} ends at ${current.end_timecode}, scene ${i + 2} starts at ${next.start_timecode}`);
      }
    } catch (e) {
      // Skip if timecodes can't be parsed
    }
  }

  // 3. Check for potential duplicates (very similar timecodes)
  console.log('📊 Checking for potential duplicates...');
  const seenTimecodes = new Map<string, number>();
  
  entries.forEach((entry, index) => {
    const key = `${entry.start_timecode}-${entry.end_timecode}`;
    
    if (seenTimecodes.has(key)) {
      const originalIndex = seenTimecodes.get(key)!;
      warnings.push(`Potential duplicate: scene ${index + 1} has same timecodes as scene ${originalIndex + 1} (${entry.start_timecode} - ${entry.end_timecode})`);
      stats.duplicates++;
    } else {
      seenTimecodes.set(key, index);
    }
  });

  // 4. Check for missing critical fields and EMPTY DESCRIPTIONS
  console.log('📊 Checking for missing fields and empty descriptions...');
  let emptyDescriptions = 0;
  
  entries.forEach((entry, index) => {
    if (!entry.plan_type || entry.plan_type.trim() === '') {
      warnings.push(`Entry ${index + 1}: Missing shot type (plan_type)`);
    }
    
    const desc = entry.description?.trim() || '';
    const content = entry.content?.trim() || '';
    const actualDescription = desc || content;
    
    // Проверка на пустые или бессмысленные описания
    if (!actualDescription || actualDescription === '') {
      errors.push(`❌ План ${index + 1} (${entry.start_timecode}): ПУСТОЕ ОПИСАНИЕ`);
      emptyDescriptions++;
    } else if (actualDescription === '—' || actualDescription === '-') {
      errors.push(`❌ План ${index + 1} (${entry.start_timecode}): Описание содержит только "—"`);
      emptyDescriptions++;
    } else if (actualDescription.toLowerCase() === 'музыка' && actualDescription.length < 10) {
      warnings.push(`⚠️ План ${index + 1} (${entry.start_timecode}): Описание только "Музыка" без визуального содержания`);
      emptyDescriptions++;
    }
    
    // Check if dialog field is completely empty (might be intentional for music-only scenes)
    if (!entry.dialogues || entry.dialogues.trim() === '') {
      stats.missingDialogs++;
    }
  });
  
  stats.emptyDescriptions = emptyDescriptions;
  if (emptyDescriptions > 0) {
    console.log(`❌ Found ${emptyDescriptions} plans with empty/meaningless descriptions!`);
  }

  // 5. Check order_index continuity
  console.log('📊 Validating order indices...');
  const expectedOrder = Array.from({ length: entries.length }, (_, i) => i + 1);
  const actualOrder = entries.map(e => e.order_index).sort((a, b) => a - b);
  
  for (let i = 0; i < entries.length; i++) {
    if (actualOrder[i] !== expectedOrder[i]) {
      warnings.push(`Order index gap detected: expected ${expectedOrder[i]}, got ${actualOrder[i]}`);
      break; // Only report first gap
    }
  }

  // 6. Check opening credits (should be one long scene at the start)
  console.log('📊 Checking opening credits...');
  if (entries.length > 0) {
    const firstEntry = entries[0];
    const firstDuration = timecodeToSeconds(firstEntry.end_timecode) - timecodeToSeconds(firstEntry.start_timecode);
    
    if (firstEntry.content && firstEntry.content.toLowerCase().includes('заставка')) {
      if (firstDuration < 30) {
        warnings.push(`Opening credits scene is very short (${firstDuration.toFixed(1)}s). Expected 30-120s for full opening.`);
      } else if (firstDuration > 30) {
        console.log(`✅ Opening credits is properly combined: ${firstDuration.toFixed(1)}s`);
      }
    }
  }

  // Determine if valid
  const isValid = errors.length === 0;

  // Summary
  console.log(`\n📊 VALIDATION SUMMARY:`);
  console.log(`✅ Total scenes: ${stats.totalScenes}`);
  console.log(`${stats.invalidTimecodes > 0 ? '❌' : '✅'} Invalid timecodes: ${stats.invalidTimecodes}`);
  console.log(`${stats.duplicates > 0 ? '⚠️' : '✅'} Potential duplicates: ${stats.duplicates}`);
  console.log(`${stats.timelineGaps > 0 ? '⚠️' : '✅'} Timeline gaps (>30s): ${stats.timelineGaps}`);
  console.log(`${stats.emptyDescriptions > 0 ? '❌' : '✅'} Empty descriptions: ${stats.emptyDescriptions}`);
  console.log(`⚪ Scenes without dialog: ${stats.missingDialogs}`);
  console.log(`${errors.length > 0 ? '❌' : '✅'} Errors: ${errors.length}`);
  console.log(`${warnings.length > 0 ? '⚠️' : '✅'} Warnings: ${warnings.length}`);

  return {
    isValid,
    warnings,
    errors,
    stats,
  };
}

/**
 * Check if scene has proper dialog format (NAME on separate line)
 */
export function checkDialogFormat(dialog: string): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!dialog || dialog.trim() === '') {
    return { isValid: true, issues: [] }; // Empty is OK (music-only scenes)
  }

  // Check for common wrong formats
  if (dialog.includes(': ') && dialog.match(/^[А-ЯЁA-Z]+:/)) {
    issues.push('Dialog has colon after name (should be on separate line)');
  }
  
  if (dialog.match(/Диалог \([^)]+\):/)) {
    issues.push('Dialog uses old format "Диалог (Имя):" instead of NAME on separate line');
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

