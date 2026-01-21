#!/usr/bin/env node
/**
 * Face Clustering Worker
 * 
 * Запускается как отдельный Node.js процесс, обходя Turbopack.
 * Получает путь к видео через аргументы, возвращает результат через stdout.
 * 
 * Usage: node scripts/face-cluster-worker.js <videoPath> <outputDir> [options]
 * 
 * @author AI Assistant
 * @date 2026-01-18
 */

const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Patch faceapi для работы с node-canvas
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// ═══════════════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_OPTIONS = {
  frameInterval: 5,        // Каждые 5 секунд
  distanceThreshold: 0.5,  // Порог схожести для кластеризации
  minAppearances: 5,       // Минимум появлений для сохранения кластера
};

// ═══════════════════════════════════════════════════════════════════════════
// ЗАГРУЗКА МОДЕЛЕЙ
// ═══════════════════════════════════════════════════════════════════════════

let modelsLoaded = false;

async function loadModels() {
  if (modelsLoaded) return;
  
  const modelPath = path.join(process.cwd(), 'models', 'face-api');
  
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Models not found at ${modelPath}`);
  }
  
  console.error('🎭 Loading face-api models...');
  
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  
  modelsLoaded = true;
  console.error('✅ Models loaded successfully');
}

// ═══════════════════════════════════════════════════════════════════════════
// ИЗВЛЕЧЕНИЕ КАДРОВ
// ═══════════════════════════════════════════════════════════════════════════

async function getVideoDuration(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim());
}

async function extractFrames(videoPath, outputDir, interval) {
  const duration = await getVideoDuration(videoPath);
  const frameCount = Math.ceil(duration / interval);
  
  console.error(`📸 Extracting ${frameCount} frames (every ${interval}s from ${duration.toFixed(1)}s video)...`);
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  const frames = [];
  
  for (let i = 0; i < frameCount; i++) {
    const time = i * interval;
    const framePath = path.join(outputDir, `frame_${String(i).padStart(5, '0')}.jpg`);
    
    try {
      await execAsync(
        `ffmpeg -ss ${time} -i "${videoPath}" -vframes 1 -q:v 2 -y "${framePath}" 2>/dev/null`
      );
      frames.push({ time, path: framePath });
    } catch (err) {
      // Skip failed frames
    }
    
    if ((i + 1) % 50 === 0) {
      console.error(`   📊 Extracted ${i + 1}/${frameCount} frames`);
    }
  }
  
  console.error(`✅ Extracted ${frames.length} frames`);
  return frames;
}

// ═══════════════════════════════════════════════════════════════════════════
// ДЕТЕКЦИЯ ЛИЦ
// ═══════════════════════════════════════════════════════════════════════════

async function detectFacesInFrames(frames) {
  await loadModels();
  
  const allFaces = [];
  let processed = 0;
  
  console.error(`🎭 Detecting faces in ${frames.length} frames...`);
  
  for (const frame of frames) {
    try {
      const image = await canvas.loadImage(frame.path);
      
      const detections = await faceapi
        .detectAllFaces(image, new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      
      for (const detection of detections) {
        allFaces.push({
          descriptor: Array.from(detection.descriptor),
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
      if (processed % 50 === 0) {
        console.error(`   📊 Processed ${processed}/${frames.length} frames, found ${allFaces.length} faces`);
      }
      
    } catch (err) {
      // Skip broken frames
    }
  }
  
  console.error(`✅ Detected ${allFaces.length} face instances`);
  return allFaces;
}

// ═══════════════════════════════════════════════════════════════════════════
// КЛАСТЕРИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════════════════

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function calculateCentroid(descriptors) {
  const length = descriptors[0].length;
  const centroid = new Array(length).fill(0);
  
  for (const d of descriptors) {
    for (let i = 0; i < length; i++) {
      centroid[i] += d[i];
    }
  }
  
  return centroid.map(v => v / descriptors.length);
}

function clusterFaces(faces, distanceThreshold, minAppearances) {
  console.error(`🔀 Clustering ${faces.length} faces (threshold: ${distanceThreshold})...`);
  
  const clusters = [];
  
  for (const face of faces) {
    let bestCluster = null;
    let bestDistance = Infinity;
    
    for (const cluster of clusters) {
      const distance = euclideanDistance(face.descriptor, cluster.centroid);
      if (distance < distanceThreshold && distance < bestDistance) {
        bestCluster = cluster;
        bestDistance = distance;
      }
    }
    
    if (bestCluster) {
      bestCluster.faces.push(face);
      bestCluster.appearances++;
      bestCluster.lastSeen = Math.max(bestCluster.lastSeen, face.timestamp);
      bestCluster.centroid = calculateCentroid(bestCluster.faces.map(f => f.descriptor));
    } else {
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
  
  // Filter by minimum appearances
  const filtered = clusters.filter(c => c.appearances >= minAppearances);
  
  console.error(`✅ Created ${filtered.length} clusters (filtered from ${clusters.length})`);
  
  return filtered.map(c => ({
    clusterId: c.clusterId,
    appearances: c.appearances,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
    centroid: c.centroid,
    // Include timestamps only (not full face descriptors) for Face Presence Evidence
    faceTimestamps: c.faces.map(f => f.timestamp),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

function cleanupFrames(outputDir) {
  try {
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      fs.unlinkSync(path.join(outputDir, file));
    }
    fs.rmdirSync(outputDir);
    console.error(`🧹 Cleaned up ${files.length} frame files`);
  } catch (err) {
    console.error(`⚠️ Cleanup warning: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node face-cluster-worker.js <videoPath> <outputDir> [frameInterval] [distanceThreshold] [minAppearances]');
    process.exit(1);
  }
  
  const videoPath = args[0];
  const outputDir = args[1];
  const options = {
    frameInterval: parseFloat(args[2]) || DEFAULT_OPTIONS.frameInterval,
    distanceThreshold: parseFloat(args[3]) || DEFAULT_OPTIONS.distanceThreshold,
    minAppearances: parseInt(args[4]) || DEFAULT_OPTIONS.minAppearances,
  };
  
  console.error('\n════════════════════════════════════════════════════════════');
  console.error('🎭 FACE CLUSTERING WORKER');
  console.error('════════════════════════════════════════════════════════════');
  console.error(`   Video: ${path.basename(videoPath)}`);
  console.error(`   Frame interval: ${options.frameInterval}s`);
  console.error(`   Distance threshold: ${options.distanceThreshold}`);
  console.error(`   Min appearances: ${options.minAppearances}`);
  console.error('');
  
  try {
    // Extract frames
    const frames = await extractFrames(videoPath, outputDir, options.frameInterval);
    
    // Detect faces
    const faces = await detectFacesInFrames(frames);
    
    // Cluster faces
    const clusters = clusterFaces(faces, options.distanceThreshold, options.minAppearances);
    
    // Cleanup
    cleanupFrames(outputDir);
    
    // Output result as JSON to stdout
    console.log(JSON.stringify({
      success: true,
      clusters: clusters,
      stats: {
        framesProcessed: frames.length,
        facesDetected: faces.length,
        clustersCreated: clusters.length,
      }
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
    }));
    process.exit(1);
  }
}

main();
