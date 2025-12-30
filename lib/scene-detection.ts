import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface DetectedScene {
  timecode: string;        // HH:MM:SS:FF format
  timestamp: number;       // Seconds (decimal)
  frameNumber: number;     // Frame number
}

function framesToTimecode(totalFrames: number, fps: number = 24): string {
  const safeFps = Math.max(1, Math.round(fps));
  const frames = ((totalFrames % safeFps) + safeFps) % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

/**
 * Detects all scene changes in a video using FFmpeg
 * Returns array of timecodes where cuts occur
 */
export async function detectScenes(
  videoPath: string,
  options: {
    threshold?: number;    // Scene change threshold (0.0-1.0), default 0.3
    fps?: number;          // Video FPS, default 24
    maxScenes?: number;    // Max scenes to detect (safety limit)
  } = {}
): Promise<DetectedScene[]> {
  const {
    threshold = 0.05,  // Lowered to 0.05 for precise scene detection (~30+ plans/min)
    fps = 24,
    maxScenes = 5000,
  } = options;

  console.log(`\n🎬 Starting FFmpeg scene detection...`);
  console.log(`📹 Video: ${path.basename(videoPath)}`);
  console.log(`🎯 Threshold: ${threshold}`);
  console.log(`🎞️  FPS: ${fps}`);

  try {
    // FFmpeg command to detect scene changes
    // select='gt(scene,THRESHOLD)' - detects scenes where change > threshold
    // showinfo - outputs frame info including pts_time
    const command = `ffmpeg -i "${videoPath}" \
      -filter:v "select='gt(scene,${threshold})',showinfo" \
      -f null - 2>&1`;

    console.log(`\n🔍 Running scene detection...`);
    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer for long videos
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Scene detection completed in ${elapsed}s`);

    // Parse output to extract frame index + timestamp.
    // showinfo line example (varies by ffmpeg version):
    // [Parsed_showinfo_1 @ ...] n:123 pts:... pts_time:12.345 ... 
    const output = stdout + stderr;
    const scenes: DetectedScene[] = [];

    const lines = output.split('\n');
    for (const line of lines) {
      if (!line.includes('showinfo') || !line.includes('pts_time')) continue;

      const ptsMatch = line.match(/\bpts_time:(\d+\.?\d*)\b/);
      if (!ptsMatch) continue;

      const timestamp = parseFloat(ptsMatch[1]);

      // Calculate frame number from pts_time (the only reliable source).
      // NOTE: n: from showinfo is the OUTPUT frame index (0,1,2...), NOT the video frame number!
      const frameNumber = Math.round(timestamp * fps);
      const timecode = framesToTimecode(frameNumber, fps);

      scenes.push({ timecode, timestamp, frameNumber });

      if (scenes.length >= maxScenes) {
        console.warn(`⚠️ Reached max scenes limit (${maxScenes}), stopping detection`);
        break;
      }
    }

    console.log(`\n📊 Detection results:`);
    console.log(`   Total scenes found: ${scenes.length}`);
    
    if (scenes.length > 0) {
      console.log(`   First scene: ${scenes[0].timecode} (${scenes[0].timestamp.toFixed(2)}s)`);
      console.log(`   Last scene: ${scenes[scenes.length - 1].timecode} (${scenes[scenes.length - 1].timestamp.toFixed(2)}s)`);
      
      // Calculate scenes per minute
      const duration = scenes[scenes.length - 1].timestamp;
      const scenesPerMinute = (scenes.length / (duration / 60)).toFixed(1);
      console.log(`   Scenes per minute: ${scenesPerMinute}`);
    }

    return scenes;

  } catch (error) {
    console.error('❌ FFmpeg scene detection failed:', error);
    
    // Return empty array on error (fallback to Gemini-only mode)
    return [];
  }
}

/**
 * Converts scenes array to plan boundaries
 * Each scene marks the START of a new plan
 */
export function scenesToPlanBoundaries(scenes: DetectedScene[]): Array<{
  start_timecode: string;
  end_timecode: string;
  start_timestamp: number;
  end_timestamp: number;
}> {
  const plans = [];

  for (let i = 0; i < scenes.length - 1; i++) {
    plans.push({
      start_timecode: scenes[i].timecode,
      end_timecode: scenes[i + 1].timecode,
      start_timestamp: scenes[i].timestamp,
      end_timestamp: scenes[i + 1].timestamp,
    });
  }

  console.log(`\n📐 Created ${plans.length} plan boundaries from ${scenes.length} detected scenes`);
  
  return plans;
}

// NOTE: We intentionally build timecodes from exact frame numbers (showinfo n:)
// to keep the :FF part accurate for cut points.

/**
 * Filters detected scenes to only include those within a specific time range
 * Used for chunked processing
 */
export function filterScenesForChunk(
  scenes: DetectedScene[],
  chunkStartTimecode: string,
  chunkEndTimecode: string
): DetectedScene[] {
  const chunkStartSeconds = timecodeToSeconds(chunkStartTimecode);
  const chunkEndSeconds = timecodeToSeconds(chunkEndTimecode);

  const filtered = scenes.filter(scene => 
    scene.timestamp >= chunkStartSeconds && scene.timestamp < chunkEndSeconds
  );

  console.log(`\n🎯 Filtered scenes for chunk ${chunkStartTimecode} - ${chunkEndTimecode}:`);
  console.log(`   Total scenes in range: ${filtered.length}`);

  return filtered;
}

/**
 * Converts HH:MM:SS:FF timecode to seconds
 */
function timecodeToSeconds(timecode: string, fps: number = 24): number {
  const parts = timecode.split(':').map(p => parseInt(p, 10));
  
  if (parts.length !== 4) return 0;
  
  const [hours, minutes, seconds, frames] = parts;
  
  return hours * 3600 + minutes * 60 + seconds + (frames / fps);
}

/**
 * Validates that FFmpeg is available and working
 */
export async function validateFFmpeg(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('ffmpeg -version');
    
    if (stdout.includes('ffmpeg version')) {
      console.log('✅ FFmpeg is available');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ FFmpeg is not available:', error);
    return false;
  }
}

/**
 * Estimates video FPS from file
 */
export async function detectVideoFPS(videoPath: string): Promise<number> {
  try {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    
    const { stdout } = await execAsync(command);
    
    // Parse frame rate (format: "24/1" or "24000/1001")
    const [num, den] = stdout.trim().split('/').map(n => parseInt(n, 10));
    const fps = Math.round(num / den);
    
    console.log(`🎞️  Detected video FPS: ${fps}`);
    
    return fps;
  } catch (error) {
    console.warn('⚠️ Could not detect FPS, using default 24');
    return 24;
  }
}











