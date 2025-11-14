/**
 * Video chunking utilities for processing long videos
 */

export interface VideoChunk {
  chunkIndex: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  startTimecode: string; // HH:MM:SS
  endTimecode: string; // HH:MM:SS
}

/**
 * Convert seconds to HH:MM:SS timecode format
 */
export function secondsToTimecode(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
  ].join(':');
}

/**
 * Convert HH:MM:SS timecode to seconds
 */
export function timecodeToSeconds(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  
  if (parts.length === 3) {
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
 * - Each chunk is ~20 minutes (1200 seconds)
 * - Overlaps by 15 seconds to avoid missing scenes at boundaries
 */
export function createVideoChunks(videoDuration: number): VideoChunk[] {
  const CHUNK_DURATION = 1200; // 20 minutes
  const OVERLAP_DURATION = 15; // 15 seconds overlap between chunks
  
  // If video is shorter than chunk duration, process as single chunk
  if (videoDuration <= CHUNK_DURATION) {
    return [
      {
        chunkIndex: 0,
        startTime: 0,
        endTime: videoDuration,
        startTimecode: '00:00:00',
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
      // Less than 1 minute left
      break;
    }
    
    chunkIndex++;
  }
  
  return chunks;
}

/**
 * Remove duplicate scenes that may appear in overlap zones between chunks
 * Deduplicates based on timecode similarity (within 2 seconds)
 */
export function deduplicateScenes(scenes: any[]): any[] {
  if (scenes.length === 0) return [];
  
  const deduplicated: any[] = [];
  const TIMECODE_THRESHOLD = 2; // seconds
  
  for (const scene of scenes) {
    const sceneStartSeconds = timecodeToSeconds(scene.start_timecode);
    
    // Check if this scene is a duplicate (similar start timecode)
    const isDuplicate = deduplicated.some(existing => {
      const existingStartSeconds = timecodeToSeconds(existing.start_timecode);
      return Math.abs(existingStartSeconds - sceneStartSeconds) < TIMECODE_THRESHOLD;
    });
    
    if (!isDuplicate) {
      deduplicated.push(scene);
    }
  }
  
  // Sort by timecode to ensure correct order
  deduplicated.sort((a, b) => {
    const aSeconds = timecodeToSeconds(a.start_timecode);
    const bSeconds = timecodeToSeconds(b.start_timecode);
    return aSeconds - bSeconds;
  });
  
  return deduplicated;
}

