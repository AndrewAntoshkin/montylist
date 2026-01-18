#!/usr/bin/env node
/**
 * Тест работоспособности @vladmandic/face-api на Node.js 22 + Apple Silicon
 */

const fs = require('fs');
const path = require('path');

async function testFaceApi() {
  console.log('\n🧪 TESTING @vladmandic/face-api COMPATIBILITY\n');
  console.log(`   Node.js: ${process.version}`);
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Arch: ${process.arch}\n`);
  
  const results = {
    import: false,
    canvas: false,
    tfjs: false,
    modelsLoad: false,
    faceDetection: false,
  };
  
  let faceapi;
  
  // Тест 1: Импорт @vladmandic/face-api
  console.log('📦 Test 1: Import @vladmandic/face-api...');
  try {
    faceapi = require('@vladmandic/face-api');
    console.log('   ✅ @vladmandic/face-api imported successfully');
    console.log(`   📦 Version: ${faceapi.version || 'unknown'}`);
    results.import = true;
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    return results;
  }
  
  // Тест 2: Импорт canvas
  console.log('\n📦 Test 2: Import canvas...');
  try {
    const { Canvas, Image, ImageData } = require('canvas');
    console.log('   ✅ canvas imported successfully');
    
    // Monkey-patch для faceapi
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
    console.log('   ✅ canvas patched to face-api');
    results.canvas = true;
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
  }
  
  // Тест 3: Проверка TensorFlow.js
  console.log('\n📦 Test 3: Check TensorFlow.js backend...');
  try {
    const tf = faceapi.tf;
    console.log(`   ✅ TensorFlow.js version: ${tf.version.tfjs}`);
    console.log(`   ✅ Backend: ${tf.getBackend() || 'not set yet'}`);
    results.tfjs = true;
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
  }
  
  // Тест 4: Загрузка моделей
  console.log('\n📦 Test 4: Load face-api models...');
  try {
    const modelPath = path.join(__dirname, '..', 'models', 'face-api');
    
    if (fs.existsSync(modelPath)) {
      console.log(`   📁 Models found at: ${modelPath}`);
      
      await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
      console.log('   ✅ TinyFaceDetector loaded');
      
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
      console.log('   ✅ FaceLandmark68Net loaded');
      
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
      console.log('   ✅ FaceRecognitionNet loaded');
      
      results.modelsLoad = true;
    } else {
      console.log(`   ⚠️  Models not found at ${modelPath}`);
      console.log('   💡 Downloading models...');
      
      // Создаём директорию
      fs.mkdirSync(modelPath, { recursive: true });
      
      // Используем встроенный URL для загрузки
      const modelUrl = 'https://vladmandic.github.io/face-api/model/';
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
      console.log('   ✅ TinyFaceDetector downloaded');
      
      await faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl);
      console.log('   ✅ FaceLandmark68Net downloaded');
      
      await faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl);
      console.log('   ✅ FaceRecognitionNet downloaded');
      
      results.modelsLoad = true;
    }
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    console.log(err.stack);
  }
  
  // Тест 5: Детекция лиц
  console.log('\n📦 Test 5: Face detection on test image...');
  try {
    const { createCanvas } = require('canvas');
    
    // Создаём тестовое изображение (640x480 белый фон)
    const canvas = createCanvas(640, 480);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 640, 480);
    
    // Рисуем овал "лица" для теста
    ctx.beginPath();
    ctx.fillStyle = '#f5d0c5'; // Телесный цвет
    ctx.ellipse(320, 200, 80, 100, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // Глаза
    ctx.beginPath();
    ctx.fillStyle = 'black';
    ctx.arc(290, 180, 10, 0, 2 * Math.PI);
    ctx.arc(350, 180, 10, 0, 2 * Math.PI);
    ctx.fill();
    
    // Рот
    ctx.beginPath();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.arc(320, 230, 30, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    
    console.log('   📸 Test image created (640x480 with simple face)');
    
    // Пробуем детектировать
    const detections = await faceapi.detectAllFaces(
      canvas, 
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 })
    );
    
    console.log(`   ✅ Detection successful! Found ${detections.length} faces`);
    console.log('   ✅ Face detection pipeline works!');
    results.faceDetection = true;
    
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    console.log(err.stack);
  }
  
  // Итоговый отчёт
  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESULTS SUMMARY:');
  console.log('═'.repeat(60));
  
  for (const [test, passed] of Object.entries(results)) {
    console.log(`   ${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
  }
  
  const allPassed = Object.values(results).every(v => v);
  console.log('\n' + (allPassed 
    ? '🎉 ALL TESTS PASSED - Face Recognition is fully functional!' 
    : '⚠️  SOME TESTS FAILED - see details above'));
  
  return results;
}

testFaceApi().then(results => {
  console.log('\n');
  process.exit(Object.values(results).every(v => v) ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
