/**
 * Face Clustering Module
 * 
 * Кластеризует лица в видео для автоматической идентификации персонажей.
 * Использует @vladmandic/face-api (современный форк face-api.js)
 * 
 * @author AI Assistant
 * @date 2026-01-16
 */

// ═══════════════════════════════════════════════════════════════════════════
// POLYFILLS для совместимости с Next.js Turbopack
// TextEncoder/TextDecoder требуются для TensorFlow.js
// ═══════════════════════════════════════════════════════════════════════════
import { TextEncoder, TextDecoder } from 'util';

// Ensure global polyfills for TensorFlow.js compatibility
if (typeof globalThis.TextEncoder === 'undefined') {
  // @ts-ignore
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // @ts-ignore
  globalThis.TextDecoder = TextDecoder;
}

import * as faceapi from '@vladmandic/face-api';
import * as canvas from 'canvas';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Patch faceapi для работы с node-canvas
const { Canvas, Image, ImageData } = canvas;
// @ts-ignore
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export interface FaceInstance {
  descriptor: Float32Array;
  timestamp: number;        // Время в секундах
  confidence: number;       // Уверенность детекции (0-1)
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceCluster {
  clusterId: string;        // "FACE_0", "FACE_1", ...
  faces: FaceInstance[];    // Все экземпляры этого лица
  centroid: Float32Array;   // Центроид для сравнения
  appearances: number;      // Сколько раз появлялся
  firstSeen: number;        // Первое появление (сек)
  lastSeen: number;         // Последнее появление (сек)
  characterName?: string;   // После binding: "ГАЛИНА", "ЮСЕФ", ...
}

export interface FrameData {
  time: number;
  imagePath: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ЗАГРУЗКА МОДЕЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════

async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  
  const modelPath = path.join(process.cwd(), 'models', 'face-api');
  
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Models not found at ${modelPath}. Please run: npm run download-face-models`);
  }
  
  console.log('🎭 Loading face-api models...');
  
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  
  modelsLoaded = true;
  console.log('✅ Face-api models loaded');
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Получает длительность видео через ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    return parseFloat(stdout.trim());
  } catch (err) {
    console.error('Failed to get video duration:', err);
    return 0;
  }
}

/**
 * Евклидово расстояние между двумя дескрипторами
 */
function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Вычисляет центроид (среднее) для списка дескрипторов
 */
function calculateCentroid(descriptors: Float32Array[]): Float32Array {
  if (descriptors.length === 0) {
    return new Float32Array(128);
  }
  
  const centroid = new Float32Array(128);
  for (const desc of descriptors) {
    for (let i = 0; i < 128; i++) {
      centroid[i] += desc[i];
    }
  }
  for (let i = 0; i < 128; i++) {
    centroid[i] /= descriptors.length;
  }
  return centroid;
}

// ═══════════════════════════════════════════════════════════════════════════
// ИЗВЛЕЧЕНИЕ КАДРОВ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Извлекает кадры из видео с заданным интервалом
 * 
 * @param videoPath - Путь к видео
 * @param interval - Интервал между кадрами в секундах (по умолчанию 5)
 * @param outputDir - Директория для сохранения кадров
 */
export async function extractFrames(
  videoPath: string,
  interval: number = 5,
  outputDir?: string
): Promise<FrameData[]> {
  const duration = await getVideoDuration(videoPath);
  
  if (duration === 0) {
    console.error('❌ Could not get video duration');
    return [];
  }
  
  const framesDir = outputDir || path.join(process.cwd(), 'temp', 'face-frames');
  
  // Создаём директорию
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }
  
  const frames: FrameData[] = [];
  const totalFrames = Math.floor(duration / interval);
  
  console.log(`📸 Extracting ${totalFrames} frames (every ${interval}s from ${duration.toFixed(1)}s video)...`);
  
  for (let time = 0; time < duration; time += interval) {
    const outputPath = path.join(framesDir, `frame_${time.toFixed(0).padStart(5, '0')}.jpg`);
    
    try {
      await execAsync(
        `ffmpeg -y -ss ${time} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" 2>/dev/null`
      );
      
      frames.push({ time, imagePath: outputPath });
    } catch (err) {
      console.warn(`⚠️  Failed to extract frame at ${time}s`);
    }
  }
  
  console.log(`✅ Extracted ${frames.length} frames`);
  return frames;
}

// ═══════════════════════════════════════════════════════════════════════════
// ДЕТЕКЦИЯ ЛИЦ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Детектирует лица во всех кадрах
 */
export async function detectAllFaces(frames: FrameData[]): Promise<FaceInstance[]> {
  await loadModels();
  
  const allFaces: FaceInstance[] = [];
  let processed = 0;
  
  console.log(`🎭 Detecting faces in ${frames.length} frames...`);
  
  for (const frame of frames) {
    try {
      // Загружаем изображение
      const image = await canvas.loadImage(frame.imagePath);
      
      // Детектируем лица
      const detections = await faceapi
        .detectAllFaces(image as unknown as HTMLImageElement, new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      
      for (const detection of detections) {
        allFaces.push({
          descriptor: detection.descriptor as unknown as Float32Array,
          timestamp: frame.time,
          confidence: detection.detection.score,
          boundingBox: {
            x: detection.detection.box.x,
            y: detection.detection.box.y,
            width: detection.detection.box.width,
            height: detection.detection.box.height,
          }
        });
      }
      
      processed++;
      if (processed % 20 === 0) {
        console.log(`   📊 Processed ${processed}/${frames.length} frames, found ${allFaces.length} faces`);
      }
      
    } catch (err) {
      // Пропускаем битые кадры
    }
  }
  
  console.log(`✅ Detected ${allFaces.length} face instances in ${frames.length} frames`);
  return allFaces;
}

// ═══════════════════════════════════════════════════════════════════════════
// КЛАСТЕРИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Кластеризует лица по схожести (алгоритм incremental clustering)
 * 
 * @param faces - Все обнаруженные лица
 * @param distanceThreshold - Порог расстояния для считания лиц одинаковыми (0.5 = консервативно)
 */
export function clusterFaces(
  faces: FaceInstance[],
  distanceThreshold: number = 0.5
): FaceCluster[] {
  const clusters: FaceCluster[] = [];
  
  console.log(`🔗 Clustering ${faces.length} faces (threshold: ${distanceThreshold})...`);
  
  for (const face of faces) {
    let assignedCluster: FaceCluster | null = null;
    let minDistance = Infinity;
    
    // Ищем ближайший кластер
    for (const cluster of clusters) {
      const distance = euclideanDistance(
        face.descriptor,
        cluster.centroid
      );
      
      if (distance < distanceThreshold && distance < minDistance) {
        assignedCluster = cluster;
        minDistance = distance;
      }
    }
    
    if (assignedCluster) {
      // Добавляем в существующий кластер
      assignedCluster.faces.push(face);
      assignedCluster.appearances++;
      assignedCluster.lastSeen = Math.max(assignedCluster.lastSeen, face.timestamp);
      
      // Пересчитываем centroid (moving average для эффективности)
      assignedCluster.centroid = calculateCentroid(
        assignedCluster.faces.map(f => f.descriptor)
      );
    } else {
      // Создаём новый кластер
      clusters.push({
        clusterId: `FACE_${clusters.length}`,
        faces: [face],
        centroid: face.descriptor,
        appearances: 1,
        firstSeen: face.timestamp,
        lastSeen: face.timestamp,
      });
    }
  }
  
  // Фильтруем: оставляем только значимых персонажей (≥5 появлений)
  // и сортируем по частоте
  const significantClusters = clusters
    .filter(c => c.appearances >= 5)
    .sort((a, b) => b.appearances - a.appearances);
  
  console.log(`✅ Created ${significantClusters.length} clusters (filtered from ${clusters.length})`);
  
  return significantClusters;
}

// ═══════════════════════════════════════════════════════════════════════════
// ГЛАВНЫЙ PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export interface ClusteringOptions {
  frameInterval?: number;       // Интервал между кадрами (сек), default: 5
  distanceThreshold?: number;   // Порог расстояния, default: 0.5
  minAppearances?: number;      // Мин. появлений для персонажа, default: 5
  outputDir?: string;           // Директория для кадров
}

/**
 * Полный pipeline кластеризации лиц в видео
 * 
 * @param videoPath - Путь к видео файлу
 * @param options - Опции
 * @returns Массив кластеров лиц
 */
export async function clusterFacesInVideo(
  videoPath: string,
  options: ClusteringOptions = {}
): Promise<FaceCluster[]> {
  const {
    frameInterval = 5,
    distanceThreshold = 0.5,
    minAppearances = 5,
    outputDir,
  } = options;
  
  console.log('\n' + '═'.repeat(60));
  console.log('🎭 FACE CLUSTERING STARTED');
  console.log('═'.repeat(60));
  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Frame interval: ${frameInterval}s`);
  console.log(`   Distance threshold: ${distanceThreshold}`);
  console.log(`   Min appearances: ${minAppearances}`);
  console.log('');
  
  const startTime = Date.now();
  
  // Шаг 1: Извлекаем кадры
  const frames = await extractFrames(videoPath, frameInterval, outputDir);
  
  if (frames.length === 0) {
    console.error('❌ No frames extracted');
    return [];
  }
  
  // Шаг 2: Детектируем лица
  const faces = await detectAllFaces(frames);
  
  if (faces.length === 0) {
    console.warn('⚠️  No faces detected in video');
    return [];
  }
  
  // Шаг 3: Кластеризуем
  let clusters = clusterFaces(faces, distanceThreshold);
  
  // Фильтруем по minAppearances
  clusters = clusters.filter(c => c.appearances >= minAppearances);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Итоговый отчёт
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FACE CLUSTERING COMPLETE');
  console.log('═'.repeat(60));
  console.log(`   Total frames: ${frames.length}`);
  console.log(`   Total faces detected: ${faces.length}`);
  console.log(`   Unique characters: ${clusters.length}`);
  console.log(`   Time elapsed: ${duration}s`);
  console.log('');
  console.log('   Characters found:');
  
  for (const cluster of clusters) {
    const duration = cluster.lastSeen - cluster.firstSeen;
    console.log(`   • ${cluster.clusterId}: ${cluster.appearances} appearances (${cluster.firstSeen.toFixed(0)}s - ${cluster.lastSeen.toFixed(0)}s, span: ${duration.toFixed(0)}s)`);
  }
  
  console.log('═'.repeat(60) + '\n');
  
  return clusters;
}

// ═══════════════════════════════════════════════════════════════════════════
// ИДЕНТИФИКАЦИЯ В КОНКРЕТНОЙ СЦЕНЕ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Идентифицирует персонажей в конкретной сцене
 * 
 * @param framePath - Путь к кадру из сцены
 * @param clusters - Кластеры лиц (с characterName)
 * @returns Список персонажей в кадре
 */
export async function identifyCharactersInFrame(
  framePath: string,
  clusters: FaceCluster[]
): Promise<string[]> {
  await loadModels();
  
  try {
    const image = await canvas.loadImage(framePath);
    
    const detections = await faceapi
      .detectAllFaces(image as unknown as HTMLImageElement, new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.5
      }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    
    const characters: string[] = [];
    
    for (const detection of detections) {
      let bestMatch: { cluster: FaceCluster; distance: number } | null = null;
      
      for (const cluster of clusters) {
        const distance = euclideanDistance(
          detection.descriptor as unknown as Float32Array,
          cluster.centroid
        );
        
        if (distance < 0.6 && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { cluster, distance };
        }
      }
      
      if (bestMatch && bestMatch.cluster.characterName) {
        characters.push(bestMatch.cluster.characterName);
      } else if (bestMatch) {
        characters.push(bestMatch.cluster.clusterId);
      }
    }
    
    return characters;
    
  } catch (err) {
    console.error('Failed to identify characters:', err);
    return [];
  }
}

/**
 * Извлекает кадр из видео по таймкоду и идентифицирует персонажей
 */
export async function identifyCharactersAtTimecode(
  videoPath: string,
  timecodeSeconds: number,
  clusters: FaceCluster[]
): Promise<string[]> {
  const tempDir = path.join(process.cwd(), 'temp', 'scene-frames');
  
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const framePath = path.join(tempDir, `scene_${Date.now()}.jpg`);
  
  try {
    await execAsync(
      `ffmpeg -y -ss ${timecodeSeconds} -i "${videoPath}" -frames:v 1 -q:v 2 "${framePath}" 2>/dev/null`
    );
    
    const characters = await identifyCharactersInFrame(framePath, clusters);
    
    // Удаляем временный файл
    fs.unlinkSync(framePath);
    
    return characters;
    
  } catch (err) {
    console.error(`Failed to identify at ${timecodeSeconds}s:`, err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Очищает временные файлы кадров
 */
export function cleanupFrames(outputDir?: string): void {
  const framesDir = outputDir || path.join(process.cwd(), 'temp', 'face-frames');
  
  if (fs.existsSync(framesDir)) {
    const files = fs.readdirSync(framesDir);
    for (const file of files) {
      if (file.endsWith('.jpg')) {
        fs.unlinkSync(path.join(framesDir, file));
      }
    }
    console.log(`🗑️  Cleaned up ${files.length} frame files`);
  }
}
