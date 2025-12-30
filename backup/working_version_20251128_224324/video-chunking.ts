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
 * - Each chunk is ~10 minutes (600 seconds) - reduced from 20 to avoid Storage upload limits
 * - Overlaps by 15 seconds to avoid missing scenes at boundaries
 */
export function createVideoChunks(videoDuration: number): VideoChunk[] {
  const CHUNK_DURATION = 600; // 10 minutes (reduced from 1200 to avoid 150MB+ chunks)
  const OVERLAP_DURATION = 15; // 15 seconds overlap between chunks
  
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
      // Less than 1 minute left
      break;
    }
    
    chunkIndex++;
  }
  
  return chunks;
}

/**
 * Remove duplicate scenes that may appear in overlap zones between chunks
 * Deduplicates based on timecode similarity and content similarity
 */
export function deduplicateScenes(scenes: any[]): any[] {
  if (scenes.length === 0) return [];
  
  const deduplicated: any[] = [];
  const TIMECODE_THRESHOLD = 5; // seconds - increased from 2 to catch more duplicates
  
  for (const scene of scenes) {
    const sceneStartSeconds = timecodeToSeconds(scene.start_timecode);
    const sceneEndSeconds = timecodeToSeconds(scene.end_timecode);
    
    // Check if this scene is a duplicate
    const isDuplicate = deduplicated.some(existing => {
      const existingStartSeconds = timecodeToSeconds(existing.start_timecode);
      const existingEndSeconds = timecodeToSeconds(existing.end_timecode);
      
      // Check timecode overlap
      const timecodeSimilar = Math.abs(existingStartSeconds - sceneStartSeconds) < TIMECODE_THRESHOLD;
      
      // If timecodes are very similar (within 1 second), it's definitely a duplicate
      if (Math.abs(existingStartSeconds - sceneStartSeconds) < 1) {
        return true;
      }
      
      // If timecodes are similar and content is similar, it's a duplicate
      if (timecodeSimilar) {
        // Check content similarity (simple check if descriptions are very similar)
        const existingContent = (existing.description || '').toLowerCase().substring(0, 50);
        const sceneContent = (scene.description || '').toLowerCase().substring(0, 50);
        
        // If first 50 chars are very similar (>80% match), it's a duplicate
        if (existingContent && sceneContent) {
          let matches = 0;
          const len = Math.min(existingContent.length, sceneContent.length);
          for (let i = 0; i < len; i++) {
            if (existingContent[i] === sceneContent[i]) matches++;
          }
          const similarity = matches / len;
          if (similarity > 0.8) {
            return true;
          }
        }
        
        // Even if content differs, if timecode is very close (within 3 sec), likely duplicate
        if (Math.abs(existingStartSeconds - sceneStartSeconds) < 3) {
          return true;
        }
      }
      
      return false;
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

