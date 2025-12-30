/**
 * PySceneDetect — обёртка над pyscenedetect CLI
 * 
 * Использует AdaptiveDetector для точного распознавания:
 * - Hard cuts (резкие склейки)
 * - Dissolves (наплывы)
 * - Fade in/out (появление/исчезновение)
 * 
 * Преимущества над FFmpeg:
 * - Меньше ложных срабатываний
 * - Лучше распознаёт наплывы и затухания
 * - Точнее определяет границы сцен
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const execAsync = promisify(exec);

export interface PySceneDetectResult {
  timecode: string;        // HH:MM:SS:FF format
  timestamp: number;       // Seconds (decimal)
  frameNumber: number;     // Frame number
  sceneType?: 'cut' | 'dissolve' | 'fade';
}

/**
 * Конвертирует секунды в таймкод HH:MM:SS:FF
 */
function secondsToTimecode(totalSeconds: number, fps: number = 24): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const frames = Math.round((totalSeconds % 1) * fps);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

/**
 * Проверяет доступность PySceneDetect
 */
export async function validatePySceneDetect(): Promise<boolean> {
  try {
    // scenedetect uses -h instead of --version
    const { stdout } = await execAsync('scenedetect -h');
    
    if (stdout.includes('PySceneDetect')) {
      console.log('✅ PySceneDetect is available');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ PySceneDetect is not available:', error);
    console.log('💡 Install: pip install scenedetect[opencv]');
    return false;
  }
}

/**
 * Детектирует сцены с помощью PySceneDetect
 * Использует AdaptiveDetector — лучший для кино
 */
export async function detectScenesWithPySceneDetect(
  videoPath: string,
  options: {
    fps?: number;
    minSceneDuration?: number;  // Минимальная длительность сцены в секундах
    adaptiveThreshold?: number; // Порог AdaptiveDetector (по умолчанию 3.0)
    contentThreshold?: number;  // Порог ContentDetector (fallback)
    maxScenes?: number;
  } = {}
): Promise<PySceneDetectResult[]> {
  const {
    fps = 24,
    minSceneDuration = 0.4,  // Минимум 0.4 секунды (~10 кадров)
    adaptiveThreshold = 3.0, // Стандартный порог, даёт ~1061 сцен = реальный лист
    maxScenes = 5000,
  } = options;

  console.log(`\n🎬 Starting PySceneDetect scene detection...`);
  console.log(`📹 Video: ${path.basename(videoPath)}`);
  console.log(`🎯 Adaptive threshold: ${adaptiveThreshold}`);
  console.log(`⏱️  Min scene duration: ${minSceneDuration}s`);
  console.log(`🎞️  FPS: ${fps}`);

  // Создаём временную директорию для результатов
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyscene-'));
  const outputPath = path.join(tempDir, 'scenes.csv');

  try {
    // PySceneDetect command с AdaptiveDetector
    // Threshold 3.0 = стандартный, даёт ~1061 сцен (соответствует реальному листу)
    const command = `scenedetect \
      -i "${videoPath}" \
      -o "${tempDir}" \
      detect-adaptive \
      -t ${adaptiveThreshold} \
      -m ${Math.round(minSceneDuration * fps)} \
      list-scenes -f scenes.csv`;

    console.log(`\n🔍 Running PySceneDetect...`);
    console.log(`📝 AdaptiveDetector: threshold=${adaptiveThreshold}`);
    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer
      timeout: 600000, // 10 минут таймаут
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ PySceneDetect completed in ${elapsed}s`);

    // Парсим вывод или CSV файл
    const scenes: PySceneDetectResult[] = [];
    const output = stdout + stderr;
    
    // Log output for debugging
    console.log(`📋 PySceneDetect output (first 500 chars):`);
    console.log(output.substring(0, 500));

    // Пробуем прочитать CSV
    const csvPath = path.join(tempDir, 'scenes.csv');
    let csvFound = false;
    
    try {
      const csvContent = await fs.readFile(csvPath, 'utf-8');
      console.log(`📄 CSV found, parsing...`);
      csvFound = true;
      
      const lines = csvContent.split('\n');
      console.log(`   CSV lines: ${lines.length}`);
      
      // Skip header line(s)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        // CSV format: Scene Number, Start Frame, Start Timecode, Start Time (seconds), End Frame, End Timecode, End Time (seconds), Length (frames), Length (timecode), Length (seconds)
        if (parts.length >= 4) {
          const sceneNum = parseInt(parts[0], 10);
          const startFrame = parseInt(parts[1], 10);
          const startTimecode = parts[2]?.trim();
          const startTime = parseFloat(parts[3]);
          
          if (!isNaN(startTime)) {
            scenes.push({
              timecode: secondsToTimecode(startTime, fps),
              timestamp: startTime,
              frameNumber: !isNaN(startFrame) ? startFrame : Math.round(startTime * fps),
              sceneType: 'cut',
            });
          }
        }
      }
      console.log(`   Parsed ${scenes.length} scenes from CSV`);
    } catch (csvError) {
      console.log('📝 CSV not found, parsing stdout...');
    }
    
    // Если CSV не найден или пустой — парсим stdout
    if (scenes.length === 0) {
      console.log('📝 Parsing stdout output...');
      
      // Формат 1: | Scene # | Start Frame | ... | Start Time |
      // Ищем строки таблицы
      const tableRowRegex = /\|\s*(\d+)\s*\|\s*(\d+)\s*\|[^|]+\|\s*([\d.]+)\s*\|/g;
      let match;
      
      while ((match = tableRowRegex.exec(output)) !== null) {
        const sceneNum = parseInt(match[1], 10);
        const startFrame = parseInt(match[2], 10);
        const startTime = parseFloat(match[3]);
        
        if (!isNaN(startTime) && startTime >= 0) {
          scenes.push({
            timecode: secondsToTimecode(startTime, fps),
            timestamp: startTime,
            frameNumber: startFrame,
            sceneType: 'cut',
          });
        }
      }
      
      // Формат 2: Scene 1: 00:00:00.000 - 00:00:05.123
      if (scenes.length === 0) {
        const sceneRegex = /Scene\s+(\d+).*?(\d+:\d+:\d+[.,]\d+)/gi;
        while ((match = sceneRegex.exec(output)) !== null) {
          const timeStr = match[2].replace(',', '.');
          const [h, m, s] = timeStr.split(':');
          const timestamp = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
          
          scenes.push({
            timecode: secondsToTimecode(timestamp, fps),
            timestamp,
            frameNumber: Math.round(timestamp * fps),
            sceneType: 'cut',
          });
        }
      }
      
      console.log(`   Parsed ${scenes.length} scenes from stdout`);
    }

    // Добавляем начальную сцену если её нет
    if (scenes.length === 0 || scenes[0].timestamp > 0.5) {
      scenes.unshift({
        timecode: '00:00:00:00',
        timestamp: 0,
        frameNumber: 0,
        sceneType: 'cut',
      });
    }

    // Ограничиваем количество сцен
    if (scenes.length > maxScenes) {
      console.warn(`⚠️ Limiting to ${maxScenes} scenes`);
      scenes.length = maxScenes;
    }

    console.log(`\n📊 PySceneDetect results:`);
    console.log(`   Total scenes found: ${scenes.length}`);
    
    if (scenes.length > 0) {
      console.log(`   First scene: ${scenes[0].timecode} (${scenes[0].timestamp.toFixed(2)}s)`);
      if (scenes.length > 1) {
        console.log(`   Last scene: ${scenes[scenes.length - 1].timecode} (${scenes[scenes.length - 1].timestamp.toFixed(2)}s)`);
        
        // Calculate scenes per minute
        const duration = scenes[scenes.length - 1].timestamp;
        if (duration > 0) {
          const scenesPerMinute = (scenes.length / (duration / 60)).toFixed(1);
          console.log(`   Scenes per minute: ${scenesPerMinute}`);
        }
      }
    }

    return scenes;

  } catch (error) {
    console.error('❌ PySceneDetect failed:', error);
    
    // Fallback: возвращаем пустой массив, обработка продолжится с AI-only
    return [];
    
  } finally {
    // Очищаем временную директорию
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Альтернативный метод с ContentDetector (если Adaptive не работает)
 */
export async function detectScenesWithContentDetector(
  videoPath: string,
  options: {
    fps?: number;
    threshold?: number;
    minSceneDuration?: number;
  } = {}
): Promise<PySceneDetectResult[]> {
  const {
    fps = 24,
    threshold = 27.0, // Стандартный порог ContentDetector
    minSceneDuration = 0.4,
  } = options;

  console.log(`\n🎬 PySceneDetect ContentDetector fallback...`);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyscene-content-'));

  try {
    const command = `scenedetect \
      --input "${videoPath}" \
      --output "${tempDir}" \
      detect-content \
      --threshold ${threshold} \
      --min-scene-len ${minSceneDuration}s \
      list-scenes \
      --filename scenes.csv \
      --no-output-file`;

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: 600000,
    });

    // Парсим результаты (аналогично)
    const scenes: PySceneDetectResult[] = [];
    const outputPath = path.join(tempDir, 'scenes.csv');

    try {
      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.split('\n').slice(1);
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length >= 4) {
          const timestamp = parseFloat(parts[3]);
          if (!isNaN(timestamp)) {
            scenes.push({
              timecode: secondsToTimecode(timestamp, fps),
              timestamp,
              frameNumber: Math.round(timestamp * fps),
              sceneType: 'cut',
            });
          }
        }
      }
    } catch {
      // Parse stdout if CSV not found
      const sceneRegex = /Scene\s+\d+:\s+(\d+:\d+:\d+\.\d+)/g;
      let match;
      while ((match = sceneRegex.exec(stdout + stderr)) !== null) {
        const [h, m, s] = match[1].split(':');
        const timestamp = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
        scenes.push({
          timecode: secondsToTimecode(timestamp, fps),
          timestamp,
          frameNumber: Math.round(timestamp * fps),
        });
      }
    }

    if (scenes.length === 0 || scenes[0].timestamp > 0.5) {
      scenes.unshift({
        timecode: '00:00:00:00',
        timestamp: 0,
        frameNumber: 0,
      });
    }

    console.log(`📊 ContentDetector found ${scenes.length} scenes`);
    return scenes;

  } catch (error) {
    console.error('❌ ContentDetector failed:', error);
    return [];
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Конвертирует результаты PySceneDetect в границы планов
 */
export function pyScenesToPlanBoundaries(scenes: PySceneDetectResult[]): Array<{
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

  console.log(`\n📐 Created ${plans.length} plan boundaries from ${scenes.length} PySceneDetect scenes`);
  
  return plans;
}

