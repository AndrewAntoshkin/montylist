#!/usr/bin/env node

/**
 * Скрипт для проверки квот и использования Replicate API
 * 
 * Использование:
 *   node scripts/check-replicate-quota.js
 */

const Replicate = require('replicate');
require('dotenv').config({ path: '.env.local' });

async function checkQuotas() {
  console.log('🔍 Проверка квот Replicate...\n');

  // Собираем все токены из пула
  const tokens = [];
  for (let i = 1; i <= 10; i++) {
    const token = process.env[`REPLICATE_API_TOKEN_${i}`];
    if (token) {
      tokens.push({ index: i, token });
    }
  }

  if (tokens.length === 0) {
    console.error('❌ Ошибка: Токены Replicate не найдены в .env.local');
    console.error('   Ищу REPLICATE_API_TOKEN_1, REPLICATE_API_TOKEN_2, и т.д.');
    process.exit(1);
  }

  console.log(`✅ Найдено токенов: ${tokens.length}\n`);
  console.log('═'.repeat(70));

  // Проверяем каждый токен
  for (const { index, token } of tokens) {
    console.log(`\n🔑 Проверка токена #${index}`);
    console.log('─'.repeat(70));
    
    const replicate = new Replicate({
      auth: token,
    });

    await checkSingleToken(replicate, index);
  }

  console.log('\n═'.repeat(70));
  console.log('\n💡 Полезные ссылки:');
  console.log('   • Биллинг: https://replicate.com/account/billing');
  console.log('   • История: https://replicate.com/predictions');
  console.log('   • Gemini 3 Pro: https://replicate.com/google/gemini-3-pro');
  console.log('   • Gemini 2.5 Flash: https://replicate.com/google/gemini-2.5-flash');
}

async function checkSingleToken(replicate, tokenIndex) {
  try {
    // Получаем информацию об аккаунте
    try {
      const account = await replicate.accounts.current();
      console.log('✅ Информация об аккаунте:');
      console.log(JSON.stringify(account, null, 2));
    } catch (accountError) {
      console.log('⚠️  Информация об аккаунте недоступна через API');
    }
    
    // Получаем список последних predictions
    const predictions = await replicate.predictions.list();
    
    if (!predictions.results || predictions.results.length === 0) {
      console.log('ℹ️  Нет недавних предсказаний для этого токена');
      return;
    }

    // Статистика по моделям
    const modelStats = {};
    const statusStats = {
      succeeded: 0,
      failed: 0,
      processing: 0,
      starting: 0,
      canceled: 0,
    };

    predictions.results.forEach(p => {
      // Подсчет по моделям
      const model = p.model || 'unknown';
      if (!modelStats[model]) {
        modelStats[model] = { total: 0, succeeded: 0, failed: 0 };
      }
      modelStats[model].total++;
      if (p.status === 'succeeded') modelStats[model].succeeded++;
      if (p.status === 'failed') modelStats[model].failed++;

      // Подсчет по статусам
      if (statusStats[p.status] !== undefined) {
        statusStats[p.status]++;
      }
    });

    console.log('\n📊 Статистика использования:');
    console.log('\n🎯 По статусам:');
    Object.entries(statusStats).forEach(([status, count]) => {
      if (count > 0) {
        const icon = status === 'succeeded' ? '✅' : status === 'failed' ? '❌' : '⏳';
        console.log(`   ${icon} ${status}: ${count}`);
      }
    });

    console.log('\n🤖 По моделям:');
    Object.entries(modelStats).forEach(([model, stats]) => {
      const modelShort = model.split('/').pop() || model;
      console.log(`   ${modelShort}:`);
      console.log(`      Всего: ${stats.total}`);
      console.log(`      Успешно: ${stats.succeeded} (${Math.round(stats.succeeded/stats.total*100)}%)`);
      if (stats.failed > 0) {
        console.log(`      Ошибки: ${stats.failed} (${Math.round(stats.failed/stats.total*100)}%)`);
      }
    });

    console.log('\n📋 Последние 5 предсказаний:');
    predictions.results.slice(0, 5).forEach((p, i) => {
      const statusIcon = p.status === 'succeeded' ? '✅' : 
                        p.status === 'failed' ? '❌' : 
                        p.status === 'processing' ? '⏳' : '🔄';
      const date = new Date(p.created_at).toLocaleString('ru-RU');
      const model = p.model?.split('/').pop() || 'unknown';
      
      console.log(`\n   ${i + 1}. ${statusIcon} ${model} - ${p.status} (${date})`);
      
      if (p.status === 'failed' && p.error) {
        const errorPreview = String(p.error).substring(0, 100);
        console.log(`      ❌ ${errorPreview}${p.error.length > 100 ? '...' : ''}`);
      }
      
      // Показываем время выполнения
      if (p.completed_at && p.started_at) {
        const duration = new Date(p.completed_at) - new Date(p.started_at);
        console.log(`      ⏱️  ${Math.round(duration / 1000)}с`);
      }
    });
    
  } catch (error) {
    console.error('\n❌ Ошибка при получении данных для токена #' + tokenIndex + ':');
    console.error('   ', error.message);
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('   ⚠️  Токен недействителен или истёк');
      console.error('   Проверьте токен на: https://replicate.com/account/api-tokens');
    }
    
    if (error.message.includes('429')) {
      console.error('   ⚠️  Достигнут лимит запросов к API (Rate limit)');
      console.error('   Это может означать исчерпание квоты!');
    }
  }
}

checkQuotas().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

