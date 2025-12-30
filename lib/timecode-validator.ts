import type { ParsedScene, MontageEntry } from '@/types';

/**
 * Validates that timecodes connect properly (no gaps, no overlaps)
 */
export function validateTimecodeSequence(scenes: ParsedScene[] | MontageEntry[]): {
  isValid: boolean;
  gaps: Array<{ afterPlan: number; gap: string; gapDuration: number }>;
  overlaps: Array<{ plans: string; overlap: string }>;
  warnings: string[];
} {
  const gaps: Array<{ afterPlan: number; gap: string; gapDuration: number }> = [];
  const overlaps: Array<{ plans: string; overlap: string }> = [];
  const warnings: string[] = [];

  for (let i = 0; i < scenes.length - 1; i++) {
    const current = scenes[i];
    const next = scenes[i + 1];
    
    const currentEnd = 'end_timecode' in current ? current.end_timecode : '';
    const nextStart = 'start_timecode' in next ? next.start_timecode : '';
    
    if (!currentEnd || !nextStart) continue;
    
    // Check if timecodes connect
    if (currentEnd !== nextStart) {
      // Calculate gap/overlap duration in frames
      const currentFrames = timecodeToFrames(currentEnd);
      const nextFrames = timecodeToFrames(nextStart);
      const diff = nextFrames - currentFrames;
      
      if (diff > 0) {
        // Gap (missing frames)
        const gapTimecode = framesToTimecode(diff);
        gaps.push({
          afterPlan: i + 1,
          gap: `${currentEnd} → ${nextStart}`,
          gapDuration: diff,
        });
        
        warnings.push(
          `⚠️ GAP после плана ${i + 1}: план заканчивается ${currentEnd}, следующий начинается ${nextStart} (пропуск ${diff} кадров = ${gapTimecode})`
        );
      } else if (diff < 0) {
        // Overlap (duplicate frames)
        const overlapTimecode = framesToTimecode(Math.abs(diff));
        overlaps.push({
          plans: `${i + 1}-${i + 2}`,
          overlap: `${Math.abs(diff)} кадров`,
        });
        
        warnings.push(
          `⚠️ OVERLAP между планами ${i + 1} и ${i + 2}: перекрытие ${Math.abs(diff)} кадров (${overlapTimecode})`
        );
      }
    }
  }

  return {
    isValid: gaps.length === 0 && overlaps.length === 0,
    gaps,
    overlaps,
    warnings,
  };
}

/**
 * Converts timecode HH:MM:SS:FF to total frames (assuming 24fps)
 */
function timecodeToFrames(timecode: string, fps: number = 24): number {
  const parts = timecode.split(':').map(p => parseInt(p, 10));
  
  if (parts.length !== 4) return 0;
  
  const [hours, minutes, seconds, frames] = parts;
  
  return (
    hours * 3600 * fps +
    minutes * 60 * fps +
    seconds * fps +
    frames
  );
}

/**
 * Converts frames to timecode HH:MM:SS:FF (assuming 24fps)
 */
function framesToTimecode(totalFrames: number, fps: number = 24): string {
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

/**
 * Finds the most common gap pattern to detect systematic issues
 */
export function analyzeGapPattern(scenes: ParsedScene[] | MontageEntry[]): {
  averageGap: number;
  pattern: string;
  suggestion: string;
} {
  const validation = validateTimecodeSequence(scenes);
  
  if (validation.gaps.length === 0) {
    return {
      averageGap: 0,
      pattern: 'No gaps detected',
      suggestion: 'Timecodes are properly connected',
    };
  }
  
  const gapDurations = validation.gaps.map(g => g.gapDuration);
  const averageGap = gapDurations.reduce((a, b) => a + b, 0) / gapDurations.length;
  
  // Check if gaps are systematic (similar duration)
  const isSystematic = gapDurations.every(g => Math.abs(g - averageGap) < 5);
  
  if (isSystematic) {
    return {
      averageGap,
      pattern: `Systematic gaps of ~${Math.round(averageGap)} frames`,
      suggestion: `AI is consistently missing ${Math.round(averageGap)} frames between plans. Review prompt to ensure ALL cuts are detected.`,
    };
  }
  
  return {
    averageGap,
    pattern: 'Random gaps',
    suggestion: 'Gaps are inconsistent. AI may be missing various short plans.',
  };
}

/**
 * Calculates expected number of plans based on video duration
 * Good montage: ~20-25 plans per minute for dynamic scenes, ~10-15 for slow scenes
 */
export function estimateExpectedPlans(durationInSeconds: number, paceType: 'slow' | 'medium' | 'fast' = 'medium'): {
  min: number;
  max: number;
  recommended: number;
} {
  const minutes = durationInSeconds / 60;
  
  const rates = {
    slow: { min: 8, max: 12, recommended: 10 },
    medium: { min: 12, max: 18, recommended: 15 },
    fast: { min: 18, max: 25, recommended: 22 },
  };
  
  const rate = rates[paceType];
  
  return {
    min: Math.round(minutes * rate.min),
    max: Math.round(minutes * rate.max),
    recommended: Math.round(minutes * rate.recommended),
  };
}

/**
 * Auto-fills gaps by creating placeholder plans
 * This is a last resort - better to re-process with improved prompt
 */
export function fillTimecodeGaps(scenes: ParsedScene[]): ParsedScene[] {
  const filled: ParsedScene[] = [];
  
  for (let i = 0; i < scenes.length; i++) {
    filled.push(scenes[i]);
    
    // Check if there's a gap to next plan
    if (i < scenes.length - 1) {
      const current = scenes[i];
      const next = scenes[i + 1];
      
      if (current.end_timecode !== next.start_timecode) {
        // Create placeholder plan to fill the gap
        const gap: ParsedScene = {
          timecode: `${current.end_timecode} - ${next.start_timecode}`,
          start_timecode: current.end_timecode,
          end_timecode: next.start_timecode,
          plan_type: '???',
          description: '[ПРОПУЩЕННЫЙ ПЛАН - требуется ручная проверка]',
          dialogues: 'Музыка',
        };
        
        filled.push(gap);
        console.warn(`⚠️ Auto-filled gap between plan ${i + 1} and ${i + 2}`);
      }
    }
  }
  
  return filled;
}












