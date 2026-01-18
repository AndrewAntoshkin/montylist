/**
 * Video chunking utilities for processing long videos
 */

export interface VideoChunk {
  chunkIndex: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  startTimecode: string; // HH:MM:SS:00 (with :00 frames)
  endTimecode: string; // HH:MM:SS:00 (with :00 frames)
}

/**
 * Convert seconds to HH:MM:SS:00 timecode format (with :00 frames placeholder)
 */
export function secondsToTimecode(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
    '00', // Always append :00 for frames
  ].join(':');
}

/**
 * Convert HH:MM:SS:FF timecode to seconds (ignores frames)
 */
export function timecodeToSeconds(timecode: string, fps: number = 24): number {
  const parts = timecode.split(':').map(Number);
  
  if (parts.length === 4) {
    // HH:MM:SS:FF - include frames as fraction of second
    const hours = parts[0];
    const minutes = parts[1];
    const seconds = parts[2];
    const frames = parts[3];
    
    // Convert frames to fraction of second (assuming 24fps by default)
    const frameSeconds = frames / fps;
    
    return hours * 3600 + minutes * 60 + seconds + frameSeconds;
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  
  return 0;
}

/**
 * Create video chunks for processing long videos
 * - Each chunk is 3 minutes (180 seconds) - good balance for Gemini context
 * - NO OVERLAP! Дедупликация происходит на уровне финализации
 * 
 * ВАЖНО: Раньше был overlap 10 сек, но это вызывало дублирование планов!
 * Теперь чанки идут встык, а диалоги на границах обрабатываются через
 * сплит реплик в промпте.
 */
export function createVideoChunks(videoDuration: number): VideoChunk[] {
  const CHUNK_DURATION = 180; // 3 minutes
  const OVERLAP_DURATION = 0; // БЕЗ OVERLAP! Было 10, вызывало дубли
  
  // If video is shorter than chunk duration, process as single chunk
  if (videoDuration <= CHUNK_DURATION) {
    return [
      {
        chunkIndex: 0,
        startTime: 0,
        endTime: videoDuration,
        startTimecode: '00:00:00:00',
        endTimecode: secondsToTimecode(videoDuration),
      },
    ];
  }
  
  const chunks: VideoChunk[] = [];
  let currentStart = 0;
  let chunkIndex = 0;
  
  while (currentStart < videoDuration) {
    const currentEnd = Math.min(
      currentStart + CHUNK_DURATION,
      videoDuration
    );
    
    chunks.push({
      chunkIndex,
      startTime: currentStart,
      endTime: currentEnd,
      startTimecode: secondsToTimecode(currentStart),
      endTimecode: secondsToTimecode(currentEnd),
    });
    
    // Move to next chunk, accounting for overlap
    // (next chunk starts OVERLAP_DURATION seconds before this chunk ends)
    currentStart = currentEnd - OVERLAP_DURATION;
    
    // But if we're very close to the end, just finish
    if (videoDuration - currentStart < 60) {
      // Less than 1 minute left - include in last chunk
      break;
    }
    
    chunkIndex++;
  }
  
  return chunks;
}

/**
 * Вычисляет Jaccard similarity между двумя текстами
 * Сравнивает множества слов (более устойчиво к перефразированию)
 */
function jaccardSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  // Извлекаем слова (только кириллица и латиница, минимум 2 символа)
  const words1 = new Set(
    text1.toLowerCase().match(/[а-яёa-z]{2,}/g) || []
  );
  const words2 = new Set(
    text2.toLowerCase().match(/[а-яёa-z]{2,}/g) || []
  );
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  // Intersection
  const intersection = Array.from(words1).filter(w => words2.has(w));
  
  // Union
  const union = new Set([...words1, ...words2]);
  
  return intersection.length / union.size;
}

/**
 * Remove duplicate scenes that may appear in overlap zones between chunks
 * IMPROVED: Semantic deduplication using Jaccard similarity
 */
export function deduplicateScenes(scenes: any[]): any[] {
  if (scenes.length === 0) return [];
  
  const deduplicated: any[] = [];
  const seen = new Set<string>(); // Track exact timecode combinations
  let exactDuplicates = 0;
  let semanticDuplicates = 0;
  
  for (const scene of scenes) {
    // Create unique key from start AND end timecode
    const timecodeKey = `${scene.start_timecode}|${scene.end_timecode}`;
    
    // Check for EXACT duplicate (same start AND end timecode)
    if (seen.has(timecodeKey)) {
      exactDuplicates++;
      continue;
    }
    
    // Check for NEAR duplicate using semantic similarity
    const sceneStartSeconds = timecodeToSeconds(scene.start_timecode);
    
    const duplicateInfo = deduplicated.reduce<{ isDuplicate: boolean; reason: string }>((result, existing) => {
      if (result.isDuplicate) return result;
      
      const existingStartSeconds = timecodeToSeconds(existing.start_timecode);
      const timeDiff = Math.abs(existingStartSeconds - sceneStartSeconds);
      
      // Близкие по времени сцены (в пределах 2 секунд)
      if (timeDiff < 2.0) {
        const existingContent = existing.description || '';
        const sceneContent = scene.description || '';
        
        // Вычисляем семантическую схожесть (Jaccard)
        const descSimilarity = jaccardSimilarity(existingContent, sceneContent);
        
        // Также проверяем диалоги
        const existingDialogues = existing.dialogues || '';
        const sceneDialogues = scene.dialogues || '';
        const dialogueSimilarity = jaccardSimilarity(existingDialogues, sceneDialogues);
        
        // Средняя схожесть (описание важнее диалогов)
        const avgSimilarity = (descSimilarity * 0.7) + (dialogueSimilarity * 0.3);
        
        // Порог зависит от близости таймкодов
        // Чем ближе таймкоды - тем ниже требуемая семантическая схожесть
        const similarityThreshold = timeDiff < 0.5 ? 0.4 : 0.6;
        
        if (avgSimilarity > similarityThreshold) {
          return { 
            isDuplicate: true, 
            reason: `timeDiff=${timeDiff.toFixed(2)}s, similarity=${avgSimilarity.toFixed(2)}` 
          };
        }
      }
      
      return result;
    }, { isDuplicate: false, reason: '' });
    
    if (duplicateInfo.isDuplicate) {
      semanticDuplicates++;
      continue;
    }
    
    deduplicated.push(scene);
    seen.add(timecodeKey);
  }
  
  // Sort by timecode to ensure correct order
  deduplicated.sort((a, b) => {
    const aSeconds = timecodeToSeconds(a.start_timecode);
    const bSeconds = timecodeToSeconds(b.start_timecode);
    return aSeconds - bSeconds;
  });
  
  console.log(`🔍 Deduplication: ${scenes.length} → ${deduplicated.length}`);
  console.log(`   📌 Exact duplicates removed: ${exactDuplicates}`);
  console.log(`   🔗 Semantic duplicates removed: ${semanticDuplicates}`);
  
  return deduplicated;
}

