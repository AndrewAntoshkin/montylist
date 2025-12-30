#!/usr/bin/env node

/**
 * Скрипт для очистки хранилища Google Gemini File API
 * 
 * Использование:
 *   1. Получите API ключ: https://aistudio.google.com/app/apikey
 *   2. Добавьте в .env.local: GOOGLE_AI_API_KEY=your_key_here
 *   3. Запустите: node scripts/clean-gemini-storage.js
 */

const https = require('https');
require('dotenv').config({ path: '.env.local' });

const API_KEY = process.env.GOOGLE_AI_API_KEY;
const BASE_URL = 'generativelanguage.googleapis.com';

async function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function listFiles() {
  const path = `/v1beta/files?key=${API_KEY}&pageSize=100`;
  return makeRequest('GET', path);
}

async function deleteFile(fileName) {
  const path = `/v1beta/${fileName}?key=${API_KEY}`;
  return makeRequest('DELETE', path);
}

async function getFileMetadata(fileName) {
  const path = `/v1beta/${fileName}?key=${API_KEY}`;
  return makeRequest('GET', path);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function cleanStorage() {
  console.log('🗂️  Очистка хранилища Google Gemini File API\n');
  console.log('═'.repeat(70));

  if (!API_KEY) {
    console.log('\n❌ ОШИБКА: Google AI API ключ не найден!\n');
    console.log('📋 Что нужно сделать:\n');
    console.log('   1. Зайдите: https://aistudio.google.com/app/apikey');
    console.log('   2. Создайте API ключ (Create API key)');
    console.log('   3. Скопируйте ключ');
    console.log('   4. Откройте .env.local');
    console.log('   5. Добавьте строку: GOOGLE_AI_API_KEY=ваш_ключ_сюда\n');
    console.log('═'.repeat(70));
    console.log('\n💡 АЛЬТЕРНАТИВА: Ручная очистка\n');
    console.log('   Если у вас есть доступ к Google Cloud Console:');
    console.log('   1. https://console.cloud.google.com/');
    console.log('   2. Найдите проект Gemini API');
    console.log('   3. Перейдите в Storage/Files');
    console.log('   4. Удалите старые файлы\n');
    console.log('═'.repeat(70));
    console.log('\n⏰ ИЛИ просто подождите 48 часов - файлы удалятся сами!\n');
    process.exit(1);
  }

  console.log('\n🔍 Получение списка файлов...\n');

  try {
    const response = await listFiles();

    if (response.status !== 200) {
      console.log(`❌ Ошибка при получении списка файлов: ${response.status}`);
      console.log('Ответ:', JSON.stringify(response.data, null, 2));
      
      if (response.status === 403) {
        console.log('\n⚠️  Доступ запрещен. Проверьте:');
        console.log('   1. Правильность API ключа');
        console.log('   2. Включен ли Gemini API в вашем проекте');
        console.log('   3. https://aistudio.google.com/app/apikey\n');
      }
      
      return;
    }

    const files = response.data.files || [];

    if (files.length === 0) {
      console.log('✅ Хранилище пустое! Файлов не найдено.\n');
      console.log('   🤔 Но у вас ошибка 429... Попробуйте:');
      console.log('   1. Подождать несколько часов');
      console.log('   2. Проверить: https://ai.dev/usage?tab=rate-limit\n');
      return;
    }

    console.log(`📊 Найдено файлов: ${files.length}\n`);
    console.log('─'.repeat(70));

    let totalSize = 0;
    const fileDetails = [];

    // Собираем информацию о файлах
    for (const file of files) {
      const name = file.name;
      const displayName = file.displayName || 'Unnamed';
      const sizeBytes = parseInt(file.sizeBytes || 0);
      const createTime = file.createTime ? new Date(file.createTime).toLocaleString('ru-RU') : 'Unknown';
      const expirationTime = file.expirationTime ? new Date(file.expirationTime).toLocaleString('ru-RU') : 'Unknown';
      
      totalSize += sizeBytes;
      
      fileDetails.push({
        name,
        displayName,
        sizeBytes,
        createTime,
        expirationTime
      });
    }

    console.log(`💾 Общий размер: ${formatBytes(totalSize)}\n`);
    console.log('📋 Список файлов:\n');

    fileDetails.forEach((file, index) => {
      console.log(`${index + 1}. ${file.displayName}`);
      console.log(`   Размер: ${formatBytes(file.sizeBytes)}`);
      console.log(`   Создан: ${file.createTime}`);
      console.log(`   Истекает: ${file.expirationTime}`);
      console.log(`   ID: ${file.name}\n`);
    });

    console.log('═'.repeat(70));
    console.log('\n🗑️  Начинаю удаление файлов...\n');

    let deletedCount = 0;
    let failedCount = 0;

    for (const file of fileDetails) {
      try {
        console.log(`Удаление: ${file.displayName}...`);
        const deleteResponse = await deleteFile(file.name);
        
        if (deleteResponse.status === 200 || deleteResponse.status === 204) {
          console.log(`   ✅ Удалён (освобождено ${formatBytes(file.sizeBytes)})`);
          deletedCount++;
        } else {
          console.log(`   ❌ Ошибка: ${deleteResponse.status}`);
          failedCount++;
        }
      } catch (error) {
        console.log(`   ❌ Ошибка: ${error.message}`);
        failedCount++;
      }
      
      // Небольшая пауза между запросами
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n═'.repeat(70));
    console.log('\n📊 ИТОГИ:\n');
    console.log(`   ✅ Удалено файлов: ${deletedCount}`);
    console.log(`   ❌ Ошибок: ${failedCount}`);
    console.log(`   💾 Освобождено места: ${formatBytes(totalSize)}\n`);
    
    if (deletedCount > 0) {
      console.log('🎉 Очистка завершена! Подождите несколько минут для обновления квот.\n');
      console.log('📊 Проверьте использование: https://ai.dev/usage?tab=rate-limit\n');
    }

  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error.message);
    console.error('   Проверьте API ключ и доступ к сети\n');
  }
}

cleanStorage().catch(error => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});



