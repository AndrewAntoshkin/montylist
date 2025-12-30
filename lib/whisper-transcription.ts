import OpenAI from 'openai';
import { execSync } from 'child_process';
import { existsSync, unlinkSync, createReadStream } from 'fs';
import path from 'path';

// Types for Whisper response
export interface WhisperSegment {
  start: number;      // seconds
  end: number;        // seconds  
  text: string;
}

export interface WhisperWord {
  start: number;      // seconds (точный таймкод начала слова)
  end: number;        // seconds (точный таймкод конца слова)
  word: string;
}

export interface WhisperTranscription {
  text: string;
  segments: WhisperSegment[];
  words?: WhisperWord[];  // Word-level timestamps
  language: string;
}

// Convert seconds to timecode HH:MM:SS:FF (24fps)
function secondsToTimecodeWithFrames(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 24);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

/**
 * Extract audio from video using FFmpeg
 */
export async function extractAudioFromVideo(
  videoPath: string,
  outputPath?: string
): Promise<string> {
  const audioPath = outputPath || videoPath.replace(/\.[^.]+$/, '.mp3');
  
  console.log(`🎵 Extracting audio from: ${videoPath}`);
  
  try {
    // Extract audio as MP3, mono, 16kHz (optimal for Whisper)
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}"`,
      { stdio: 'pipe' }
    );
    
    console.log(`✅ Audio extracted to: ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error('❌ Failed to extract audio:', error);
    throw new Error('Audio extraction failed');
  }
}

/**
 * Extract audio chunk from video (for specific time range)
 */
export async function extractAudioChunk(
  videoPath: string,
  startSeconds: number,
  durationSeconds: number,
  outputPath: string
): Promise<string> {
  console.log(`🎵 Extracting audio chunk: ${startSeconds}s - ${startSeconds + durationSeconds}s`);
  
  try {
    execSync(
      `ffmpeg -y -ss ${startSeconds} -i "${videoPath}" -t ${durationSeconds} -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${outputPath}"`,
      { stdio: 'pipe' }
    );
    
    console.log(`✅ Audio chunk extracted: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('❌ Failed to extract audio chunk:', error);
    throw new Error('Audio chunk extraction failed');
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeAudio(
  audioPath: string,
  language: string = 'ru'
): Promise<WhisperTranscription> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set in environment');
  }
  
  const openai = new OpenAI({ apiKey });
  
  console.log(`🎤 Transcribing audio: ${audioPath}`);
  console.log(`🌍 Language: ${language}`);
  
  const audioFile = createReadStream(audioPath);
  
  try {
    // Use verbose_json to get word-level timestamps
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    
    console.log(`✅ Transcription completed: ${response.text.length} chars`);
    console.log(`📊 Segments: ${response.segments?.length || 0}`);
    
    // Map OpenAI response to our format
    const segments: WhisperSegment[] = (response.segments || []).map(seg => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    }));
    
    return {
      text: response.text,
      segments,
      language: response.language || language,
    };
  } catch (error) {
    console.error('❌ Whisper transcription failed:', error);
    throw error;
  }
}

/**
 * Transcribe audio with WORD-LEVEL timestamps for precise dialogue placement
 */
export async function transcribeAudioWithWords(
  audioPath: string,
  language: string = 'ru'
): Promise<WhisperTranscription> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set in environment');
  }
  
  const openai = new OpenAI({ apiKey });
  
  console.log(`🎤 Transcribing audio (word-level): ${audioPath}`);
  console.log(`🌍 Language: ${language}`);
  
  const audioFile = createReadStream(audioPath);
  
  try {
    // Use word-level timestamps for precise dialogue placement
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    
    console.log(`✅ Transcription completed: ${response.text.length} chars`);
    console.log(`📊 Segments: ${response.segments?.length || 0}`);
    console.log(`📝 Words: ${response.words?.length || 0}`);
    
    // Map segments
    const segments: WhisperSegment[] = (response.segments || []).map(seg => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    }));
    
    // Map words with precise timestamps
    const words: WhisperWord[] = (response.words || []).map(w => ({
      start: w.start,
      end: w.end,
      word: w.word.trim(),
    }));
    
    return {
      text: response.text,
      segments,
      words,
      language: response.language || language,
    };
  } catch (error) {
    console.error('❌ Whisper transcription failed:', error);
    throw error;
  }
}

/**
 * Get words that fall within a specific time range (for precise plan dialogue)
 * Includes words where the word's CENTER falls within the range,
 * OR if the word overlaps significantly with the range
 */
export function getWordsInRange(
  words: WhisperWord[],
  startSeconds: number,
  endSeconds: number
): WhisperWord[] {
  return words.filter(word => {
    // Word center point
    const wordCenter = (word.start + word.end) / 2;
    
    // Include if word center is within range (best method for short words)
    if (wordCenter >= startSeconds && wordCenter < endSeconds) {
      return true;
    }
    
    // For very long words, also check overlap
    const wordDuration = word.end - word.start;
    if (wordDuration > 1.0) {
      const overlapStart = Math.max(word.start, startSeconds);
      const overlapEnd = Math.min(word.end, endSeconds);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      return overlap > wordDuration * 0.3;
    }
    
    return false;
  });
}

/**
 * Format words into dialogue text for a specific plan
 */
export function formatWordsForPlan(
  words: WhisperWord[],
  startSeconds: number,
  endSeconds: number
): string {
  const planWords = getWordsInRange(words, startSeconds, endSeconds);
  
  if (planWords.length === 0) {
    return '';
  }
  
  // Join words with spaces
  return planWords.map(w => w.word).join(' ').trim();
}

/**
 * Find dialogue segment that matches a specific timecode
 */
export function findDialogueAtTimecode(
  segments: WhisperSegment[],
  startSeconds: number,
  endSeconds: number,
  tolerance: number = 1.0  // seconds
): WhisperSegment | null {
  // Find segment that overlaps with the given time range
  for (const segment of segments) {
    const overlapStart = Math.max(segment.start, startSeconds - tolerance);
    const overlapEnd = Math.min(segment.end, endSeconds + tolerance);
    
    if (overlapStart < overlapEnd) {
      return segment;
    }
  }
  
  return null;
}

/**
 * Get all dialogue segments within a time range
 */
export function getDialoguesInRange(
  segments: WhisperSegment[],
  startSeconds: number,
  endSeconds: number,
  tolerance: number = 0.5
): WhisperSegment[] {
  return segments.filter(segment => {
    // Segment overlaps with range if:
    // segment.start < range.end AND segment.end > range.start
    return (
      segment.start < endSeconds + tolerance &&
      segment.end > startSeconds - tolerance
    );
  });
}

/**
 * Format Whisper segments for merging with Gemini output
 * Returns dialogue text with speaker indicators
 */
export function formatDialoguesForPlan(
  segments: WhisperSegment[],
  startSeconds: number,
  endSeconds: number
): string {
  const dialogues = getDialoguesInRange(segments, startSeconds, endSeconds);
  
  if (dialogues.length === 0) {
    return '';
  }
  
  // Join all dialogue texts
  return dialogues.map(d => d.text.trim()).join(' ');
}

/**
 * Transcribe video chunk and return segments with timecodes
 */
export async function transcribeVideoChunk(
  videoPath: string,
  startSeconds: number,
  durationSeconds: number,
  tempDir: string = '/tmp/whisper'
): Promise<WhisperSegment[]> {
  // Ensure temp directory exists
  if (!existsSync(tempDir)) {
    execSync(`mkdir -p "${tempDir}"`);
  }
  
  const audioPath = path.join(tempDir, `chunk_${startSeconds}_${durationSeconds}.mp3`);
  
  try {
    // Extract audio chunk
    await extractAudioChunk(videoPath, startSeconds, durationSeconds, audioPath);
    
    // Transcribe
    const result = await transcribeAudio(audioPath, 'ru');
    
    // Adjust segment timecodes to absolute video time
    const adjustedSegments = result.segments.map(seg => ({
      start: seg.start + startSeconds,
      end: seg.end + startSeconds,
      text: seg.text,
    }));
    
    console.log(`📝 Transcribed ${adjustedSegments.length} dialogue segments for chunk ${startSeconds}s-${startSeconds + durationSeconds}s`);
    
    return adjustedSegments;
  } finally {
    // Cleanup temp audio file
    if (existsSync(audioPath)) {
      unlinkSync(audioPath);
    }
  }
}

/**
 * Transcribe full video by chunking audio into smaller pieces
 * This avoids timeout issues with long videos
 */
export async function transcribeFullVideoInChunks(
  videoPath: string,
  videoDuration: number,
  tempDir: string = '/tmp/whisper'
): Promise<WhisperSegment[]> {
  const AUDIO_CHUNK_DURATION = 300; // 5 minutes per chunk (safe for Whisper API)
  const allSegments: WhisperSegment[] = [];
  
  // Ensure temp directory exists
  if (!existsSync(tempDir)) {
    execSync(`mkdir -p "${tempDir}"`);
  }
  
  // Calculate number of chunks
  const numChunks = Math.ceil(videoDuration / AUDIO_CHUNK_DURATION);
  console.log(`🎤 Transcribing ${videoDuration}s video in ${numChunks} audio chunks (${AUDIO_CHUNK_DURATION}s each)`);
  
  for (let i = 0; i < numChunks; i++) {
    const startSeconds = i * AUDIO_CHUNK_DURATION;
    const duration = Math.min(AUDIO_CHUNK_DURATION, videoDuration - startSeconds);
    const audioPath = path.join(tempDir, `audio_chunk_${i}.mp3`);
    
    try {
      console.log(`🎵 Processing audio chunk ${i + 1}/${numChunks}: ${startSeconds}s - ${startSeconds + duration}s`);
      
      // Extract audio chunk
      await extractAudioChunk(videoPath, startSeconds, duration, audioPath);
      
      // Transcribe this chunk
      const result = await transcribeAudio(audioPath, 'ru');
      
      // Adjust segment timecodes to absolute video time
      const adjustedSegments = result.segments.map(seg => ({
        start: seg.start + startSeconds,
        end: seg.end + startSeconds,
        text: seg.text,
      }));
      
      allSegments.push(...adjustedSegments);
      console.log(`✅ Audio chunk ${i + 1}/${numChunks}: ${adjustedSegments.length} segments`);
      
    } catch (error) {
      console.error(`❌ Failed to transcribe audio chunk ${i + 1}:`, error);
      // Continue with other chunks even if one fails
    } finally {
      // Cleanup temp audio file
      if (existsSync(audioPath)) {
        unlinkSync(audioPath);
      }
    }
  }
  
  console.log(`✅ Total transcribed: ${allSegments.length} dialogue segments`);
  return allSegments;
}

/**
 * Merge Whisper dialogues with Gemini scenes
 * Uses Whisper text for dialogues, Gemini for visual descriptions
 */
export function mergeWhisperWithGemini(
  geminiScenes: Array<{
    start_timecode: string;
    end_timecode: string;
    plan_type: string;
    description: string;
    dialogues: string;
  }>,
  whisperSegments: WhisperSegment[],
  timecodeToSeconds: (tc: string) => number
): Array<{
  start_timecode: string;
  end_timecode: string;
  plan_type: string;
  description: string;
  dialogues: string;
}> {
  return geminiScenes.map(scene => {
    const startSec = timecodeToSeconds(scene.start_timecode);
    const endSec = timecodeToSeconds(scene.end_timecode);
    
    // Get Whisper dialogues for this time range
    const whisperDialogue = formatDialoguesForPlan(whisperSegments, startSec, endSec);
    
    // If Whisper found dialogue, use it (more accurate)
    // Otherwise keep Gemini's dialogue (might be from visuals like signs)
    const finalDialogue = whisperDialogue || scene.dialogues;
    
    return {
      ...scene,
      dialogues: finalDialogue,
    };
  });
}

