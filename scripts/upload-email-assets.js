/**
 * Скрипт для загрузки email assets в Supabase Storage
 * 
 * Использование:
 * 1. Убедитесь что в .env.local есть NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
 * 2. Запустите: node scripts/upload-email-assets.js
 */

const fs = require('fs');
const path = require('path');

// Загружаем переменные окружения
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Ошибка: Не найдены NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
  console.error('Убедитесь что они есть в .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const files = [
  {
    path: 'public/icons/monty-logo.svg',
    destination: 'monty-logo.svg',
    contentType: 'image/svg+xml'
  },
  {
    path: 'public/icons/monty-logo-small.svg',
    destination: 'monty-logo-small.svg',
    contentType: 'image/svg+xml'
  },
  {
    path: 'public/email-bg.png',
    destination: 'email-bg.png',
    contentType: 'image/png'
  }
];

async function createBucket() {
  console.log('📦 Создаем bucket "email-assets"...');
  
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.error('❌ Ошибка при получении списка buckets:', listError);
    return false;
  }
  
  const bucketExists = buckets.some(b => b.name === 'email-assets');
  
  if (bucketExists) {
    console.log('✅ Bucket "email-assets" уже существует');
    return true;
  }
  
  const { error } = await supabase.storage.createBucket('email-assets', {
    public: true,
    fileSizeLimit: 10485760, // 10MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml']
  });
  
  if (error) {
    console.error('❌ Ошибка при создании bucket:', error);
    return false;
  }
  
  console.log('✅ Bucket "email-assets" создан');
  return true;
}

async function uploadFile(fileInfo) {
  const filePath = path.join(__dirname, '..', fileInfo.path);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Файл не найден: ${filePath}`);
    return false;
  }
  
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log(`📤 Загружаем ${fileInfo.destination}...`);
  
  const { data, error } = await supabase.storage
    .from('email-assets')
    .upload(fileInfo.destination, fileBuffer, {
      contentType: fileInfo.contentType,
      upsert: true
    });
  
  if (error) {
    console.error(`❌ Ошибка при загрузке ${fileInfo.destination}:`, error);
    return false;
  }
  
  // Получаем публичный URL
  const { data: publicUrl } = supabase.storage
    .from('email-assets')
    .getPublicUrl(fileInfo.destination);
  
  console.log(`✅ ${fileInfo.destination} загружен`);
  console.log(`   URL: ${publicUrl.publicUrl}`);
  
  return publicUrl.publicUrl;
}

async function main() {
  console.log('🚀 Начинаем загрузку email assets в Supabase Storage\n');
  
  // Создаем bucket
  const bucketCreated = await createBucket();
  if (!bucketCreated) {
    process.exit(1);
  }
  
  console.log('\n📤 Загружаем файлы...\n');
  
  const urls = {};
  
  for (const file of files) {
    const url = await uploadFile(file);
    if (url) {
      urls[file.destination] = url;
    }
  }
  
  console.log('\n✅ Все файлы загружены!\n');
  console.log('📋 Используйте эти URL в вашем email template:\n');
  
  Object.entries(urls).forEach(([name, url]) => {
    console.log(`${name}:`);
    console.log(`  ${url}\n`);
  });
  
  console.log('\n💡 Скопируйте эти URL и замените YOUR_SITE_URL в email-templates/confirmation-email.html');
}

main().catch(console.error);

