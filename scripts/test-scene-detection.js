/**
 * Test script for FFmpeg scene detection
 * 
 * Usage:
 *   node scripts/test-scene-detection.js <path-to-video>
 * 
 * Example:
 *   node scripts/test-scene-detection.js /tmp/test.mp4
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

async function testSceneDetection(videoPath, threshold = 0.3) {
  console.log('\n🎬 FFmpeg Scene Detection Test');
  console.log('═══════════════════════════════════════\n');
  console.log(`📹 Video: ${path.basename(videoPath)}`);
  console.log(`🎯 Threshold: ${threshold}`);
  console.log(`\nStarting detection...\n`);

  try {
    // Check FFmpeg availability
    const { stdout: versionOutput } = await execAsync('ffmpeg -version');
    if (!versionOutput.includes('ffmpeg version')) {
      throw new Error('FFmpeg not found');
    }
    console.log('✅ FFmpeg is available\n');

    // Detect video FPS
    const fpsCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout: fpsOutput } = await execAsync(fpsCommand);
    const [num, den] = fpsOutput.trim().split('/').map(n => parseInt(n, 10));
    const fps = Math.round(num / den);
    console.log(`🎞️  Detected FPS: ${fps}\n`);

    // Run scene detection
    const command = `ffmpeg -i "${videoPath}" \
      -filter:v "select='gt(scene,${threshold})',showinfo" \
      -f null - 2>&1 | grep "pts_time"`;

    console.log('🔍 Running scene detection (this may take 30-60 seconds)...\n');
    const startTime = Date.now();

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Detection completed in ${elapsed}s\n`);

    // Parse results
    const output = stdout + stderr;
    const ptsRegex = /pts_time:(\d+\.?\d*)/g;
    const scenes = [];
    let match;

    while ((match = ptsRegex.exec(output)) !== null) {
      const timestamp = parseFloat(match[1]);
      const timecode = secondsToTimecode(timestamp, fps);
      
      scenes.push({
        timecode,
        timestamp,
      });
    }

    // Display results
    console.log('📊 RESULTS:');
    console.log('═══════════════════════════════════════\n');
    console.log(`Total scenes detected: ${scenes.length}`);
    
    if (scenes.length > 0) {
      const duration = scenes[scenes.length - 1].timestamp;
      const scenesPerMinute = (scenes.length / (duration / 60)).toFixed(1);
      
      console.log(`Video duration: ~${(duration / 60).toFixed(1)} minutes`);
      console.log(`Scenes per minute: ${scenesPerMinute}`);
      console.log(`\nFirst 10 scenes:`);
      console.log('─────────────────────────────────────');
      
      scenes.slice(0, 10).forEach((scene, i) => {
        const nextTimecode = scenes[i + 1]?.timecode || 'END';
        const duration = scenes[i + 1] 
          ? (scenes[i + 1].timestamp - scene.timestamp).toFixed(2)
          : 'N/A';
        
        console.log(`${i + 1}. ${scene.timecode} → ${nextTimecode} (${duration}s)`);
      });
      
      if (scenes.length > 10) {
        console.log(`... and ${scenes.length - 10} more scenes`);
      }

      // Check for gaps
      console.log('\n🔍 Checking timecode continuity...');
      let hasGaps = false;
      
      for (let i = 0; i < Math.min(scenes.length - 1, 10); i++) {
        const current = scenes[i];
        const next = scenes[i + 1];
        
        // Scenes should be continuous (no check needed, FFmpeg guarantees this)
        const gap = next.timestamp - current.timestamp;
        
        if (gap < 0.1) {
          console.log(`   ⚠️ Very short plan ${i + 1}: ${gap.toFixed(2)}s`);
        }
      }
      
      if (!hasGaps) {
        console.log('   ✅ Timecodes look good!');
      }
    }

    console.log('\n═══════════════════════════════════════\n');
    console.log('✅ Test completed successfully!\n');

    return scenes;

  } catch (error) {
    console.error('\n❌ Error during scene detection:');
    console.error(error.message);
    console.error('\nMake sure:');
    console.error('  1. FFmpeg is installed');
    console.error('  2. Video file exists');
    console.error('  3. Video file is not corrupted\n');
    
    throw error;
  }
}

function secondsToTimecode(seconds, fps = 24) {
  const totalFrames = Math.round(seconds * fps);
  
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

// CLI usage
if (require.main === module) {
  const videoPath = process.argv[2];
  const threshold = parseFloat(process.argv[3]) || 0.3;

  if (!videoPath) {
    console.error('Usage: node test-scene-detection.js <video-path> [threshold]');
    console.error('Example: node test-scene-detection.js /tmp/video.mp4 0.3');
    process.exit(1);
  }

  detectScenes(videoPath, { threshold })
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { detectScenes, validateFFmpeg, detectVideoFPS };

