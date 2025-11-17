import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

// Try to use @ffmpeg-installer/ffmpeg if available
// This will work when deployed, but might have issues in Next.js dev mode
try {
  // Dynamic import to avoid build-time issues
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    console.log('✅ Using installed FFmpeg:', ffmpegInstaller.path);
  }
} catch (error) {
  // Fallback to system FFmpeg or default command
  console.log('⚠️  Using system FFmpeg (ffmpeg command must be in PATH)');
  // fluent-ffmpeg will try to use 'ffmpeg' command from PATH
}

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const existsAsync = promisify(fs.exists);

export interface VideoChunkFile {
  chunkIndex: number;
  localPath: string;
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Downloads video from URL to local temp file
 */
export async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  console.log(`📥 Downloading video from: ${videoUrl.substring(0, 100)}...`);
  
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  await writeFileAsync(outputPath, Buffer.from(buffer));
  
  console.log(`✅ Video downloaded to: ${outputPath}`);
}

/**
 * Splits video into chunks using FFmpeg
 * Returns array of chunk file paths
 */
export async function splitVideoIntoChunks(
  inputVideoPath: string,
  chunks: Array<{ chunkIndex: number; startTime: number; endTime: number }>,
  tempDir: string = '/tmp'
): Promise<VideoChunkFile[]> {
  const chunkFiles: VideoChunkFile[] = [];
  
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  for (const chunk of chunks) {
    const outputPath = path.join(tempDir, `chunk_${chunk.chunkIndex}_${Date.now()}.mp4`);
    const duration = chunk.endTime - chunk.startTime;
    
    console.log(`✂️  Cutting chunk ${chunk.chunkIndex + 1}: ${chunk.startTime}s - ${chunk.endTime}s (${duration}s)`);
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputVideoPath)
        .setStartTime(chunk.startTime)
        .setDuration(duration)
        .output(outputPath)
        .outputOptions([
          '-c:v libx264',         // Re-encode video для корректного moov atom
          '-preset ultrafast',    // Максимальная скорость
          '-crf 23',              // Качество
          '-c:a aac',             // Re-encode audio to AAC
          '-b:a 128k',            // Audio bitrate
          '-ar 44100',            // Sample rate
          '-movflags +faststart', // moov atom в начало (CRITICAL!)
          '-f mp4',               // Force MP4 format
        ])
        .on('start', (commandLine) => {
          console.log(`FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Chunk ${chunk.chunkIndex + 1} progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log(`✅ Chunk ${chunk.chunkIndex + 1} created: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`❌ FFmpeg error for chunk ${chunk.chunkIndex + 1}:`, err.message);
          reject(err);
        })
        .run();
    });
    
    chunkFiles.push({
      chunkIndex: chunk.chunkIndex,
      localPath: outputPath,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      duration,
    });
  }
  
  console.log(`✅ All ${chunkFiles.length} chunks created successfully`);
  return chunkFiles;
}

/**
 * Cleans up temporary files
 */
export async function cleanupTempFiles(files: string[]): Promise<void> {
  console.log(`🧹 Cleaning up ${files.length} temporary files...`);
  
  for (const file of files) {
    try {
      if (await existsAsync(file)) {
        await unlinkAsync(file);
        console.log(`🗑️  Deleted: ${file}`);
      }
    } catch (error) {
      console.error(`Failed to delete ${file}:`, error);
    }
  }
  
  console.log(`✅ Cleanup complete`);
}

/**
 * Get video duration using FFmpeg
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const duration = metadata.format.duration || 0;
        resolve(Math.floor(duration));
      }
    });
  });
}

