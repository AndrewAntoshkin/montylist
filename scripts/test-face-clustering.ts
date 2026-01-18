#!/usr/bin/env npx tsx
/**
 * Тест Face Clustering на реальном видео
 * 
 * Запуск: npx tsx scripts/test-face-clustering.ts /path/to/video.mp4
 */

import { clusterFacesInVideo, cleanupFrames } from '../lib/face-clustering';
import * as path from 'path';

async function main() {
  const videoPath = process.argv[2];
  
  if (!videoPath) {
    console.log(`
🎭 Face Clustering Test

Usage: npx tsx scripts/test-face-clustering.ts <video_path>

Example:
  npx tsx scripts/test-face-clustering.ts ./test-video.mp4
  npx tsx scripts/test-face-clustering.ts /path/to/movie.mp4

Options:
  The script will:
  1. Extract frames every 5 seconds
  2. Detect faces in each frame
  3. Cluster similar faces together
  4. Report unique characters found
`);
    process.exit(1);
  }
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🎭 FACE CLUSTERING TEST                                   ║
╠════════════════════════════════════════════════════════════╣
║  Video: ${path.basename(videoPath).slice(0, 45).padEnd(45)} ║
╚════════════════════════════════════════════════════════════╝
`);
  
  try {
    const startTime = Date.now();
    
    // Запускаем кластеризацию
    const clusters = await clusterFacesInVideo(videoPath, {
      frameInterval: 5,        // Каждые 5 секунд
      distanceThreshold: 0.5,  // Консервативный порог
      minAppearances: 5,       // Минимум 5 появлений
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Итоговый отчёт
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  📊 FINAL REPORT                                           ║
╠════════════════════════════════════════════════════════════╣`);
    
    if (clusters.length === 0) {
      console.log(`║  ⚠️  No significant characters found                       ║`);
    } else {
      console.log(`║  ✅ Found ${clusters.length.toString().padEnd(2)} unique characters                          ║`);
      console.log(`╠════════════════════════════════════════════════════════════╣`);
      
      for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i];
        const span = c.lastSeen - c.firstSeen;
        console.log(`║  ${(i + 1).toString().padStart(2)}. ${c.clusterId.padEnd(10)} ${c.appearances.toString().padStart(4)} appearances, ${span.toFixed(0).padStart(4)}s span ║`);
      }
    }
    
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║  ⏱️  Total time: ${duration.padStart(6)}s                                   ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝
`);
    
    // Очистка временных файлов
    console.log('🗑️  Cleaning up temporary files...');
    cleanupFrames();
    
    console.log('✅ Done!\n');
    
    // Возвращаем кластеры для дальнейшего использования
    return clusters;
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();
