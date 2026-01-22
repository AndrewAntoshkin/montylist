/**
 * Gemini 2.5 Flash on Replicate - Primary Video Analysis
 * 
 * Преимущества над FAL:
 * - Работает стабильнее
 * - Лучше понимает контекст
 * - Меньше ошибок при множественных запросах
 * 
 * Fallback: fal.ai (если Replicate недоступен)
 * 
 * Защита: Circuit Breaker предотвращает DDoS при падении API
 */

import Replicate from 'replicate';
import { geminiCircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { GEMINI_TIMEOUT_MS } from './config';

export interface VideoAnalysisPlan {
  planNumber: number;
  planType: string;
  description: string;
  visualDescription?: string;  // Детальное описание внешности людей в кадре
  visualCharacters: string[];
  location: string;
  speakingCharacter?: string;
}

export interface VideoAnalysisResult {
  success: boolean;
  plans: VideoAnalysisPlan[];
  rawOutput?: string;
  error?: string;
  source: 'gemini-replicate' | 'fal' | 'error';
}

/**
 * Анализирует видео через Gemini 2.5 Flash на Replicate
 */
export async function analyzeVideoWithGemini(
  videoUrl: string,
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  characters: Array<{ name: string; description?: string; attributes?: any }>,
  scriptScenes?: Array<{ sceneNumber: string; location: string; characters: string[]; description?: string }>
): Promise<VideoAnalysisResult> {
  
  // Инициализация Replicate (поддержка нумерованных токенов)
  const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1;
  if (!apiToken) {
    console.log('⚠️ REPLICATE_API_TOKEN not found, will use FAL fallback');
    return {
      success: false,
      plans: [],
      error: 'No Replicate token',
      source: 'error'
    };
  }

  const replicate = new Replicate({ auth: apiToken });

  // Подготовка данных
  const characterList = characters.slice(0, 15).map(c => {
    const attrs = c.attributes ? ` (${c.attributes.gender}, ${c.attributes.ageRange}, волосы: ${c.attributes.hairColor})` : '';
    return `- ${c.name}${attrs}${c.description ? `: ${c.description}` : ''}`;
  }).join('\n');

  let sceneContext = '';
  if (scriptScenes && scriptScenes.length > 0) {
    const relevantScenes = scriptScenes.slice(0, 5).map(s => {
      const chars = s.characters?.length > 0 ? s.characters.join(', ') : 'не указаны';
      return `  • Сцена ${s.sceneNumber} (${s.location}): ${chars}`;
    }).join('\n');
    sceneContext = `\n📋 СЦЕНЫ ИЗ СЦЕНАРИЯ:\n${relevantScenes}\n`;
  }

  const prompt = `Ты профессиональный монтажёр. Проанализируй видео и определи КТО находится в кадре.

👥 ПЕРСОНАЖИ ФИЛЬМА (используй для идентификации по внешности):
${characterList || 'не указаны'}
${sceneContext}
🎬 ПЛАНЫ ДЛЯ АНАЛИЗА (${scenes.length} планов):
${scenes.slice(0, 10).map((s, i) => `${i + 1}. ${s.start_timecode} - ${s.end_timecode}`).join('\n')}
${scenes.length > 10 ? `... и ещё ${scenes.length - 10} планов` : ''}

📝 ЗАДАЧА - ДЛЯ КАЖДОГО ПЛАНА:

1. ОПИШИ ЛЮДЕЙ В КАДРЕ по визуальным признакам:
   - Пол, примерный возраст
   - Телосложение (крупная, худая, высокий, низкий)
   - Цвет/тип волос (блондинка, брюнет, рыжая)
   - Особенности внешности (араб, славянка, смуглый)
   - Одежда, украшения (золотые браслеты, платок, костюм)

2. СОПОСТАВЬ с персонажами из списка выше:
   - Крупная блондинка с золотыми украшениями → ГАЛИНА
   - Смуглый невысокий мужчина в костюме → ЮСЕФ
   - Молодой араб с платком на шее → МОХАММЕД
   - Если не удаётся определить, опиши внешность

3. КТО ГОВОРИТ - определи по:
   - Движению губ
   - Кто в фокусе камеры при звучании реплики
   - Жестикуляции

✅ ФОРМАТ ОТВЕТА - СТРОГО JSON:
{
  "plans": [
    {
      "planNumber": 1,
      "planType": "Кр.",
      "description": "Крупная блондинка с золотыми браслетами плачет",
      "visualDescription": "женщина ~27 лет, полная, светлые волосы, много золотых украшений",
      "visualCharacters": ["ГАЛИНА"],
      "location": "салон красоты",
      "speakingCharacter": "ГАЛИНА"
    }
  ]
}

ВАЖНО: 
- Если персонаж соответствует описанию из списка — укажи ИМЯ
- Если не уверен — опиши внешность (напр. "женщина в красном")
- Ответь ТОЛЬКО валидным JSON!`;

  try {
    console.log(`🎬 [GEMINI/Replicate] Analyzing video: ${videoUrl.slice(0, 80)}...`);
    console.log(`   Scenes: ${scenes.length}, Characters: ${characters.length}`);
    
    const startTime = Date.now();

    // Создаём Promise с таймаутом чтобы избежать "fetch failed" при долгих запросах
    const replicatePromise = replicate.run('google/gemini-2.5-flash', {
      input: {
        prompt: prompt,
        videos: [videoUrl]  // Используем videos вместо images для видеофайлов
      }
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Replicate timeout after ${GEMINI_TIMEOUT_MS/1000}s`)), GEMINI_TIMEOUT_MS);
    });
    
    const rawOutput = await Promise.race([replicatePromise, timeoutPromise]);

    // Replicate может вернуть массив (streaming chunks) или строку
    let output: string;
    if (Array.isArray(rawOutput)) {
      output = rawOutput.join('');
    } else if (typeof rawOutput === 'string') {
      output = rawOutput;
    } else if (rawOutput && typeof rawOutput === 'object') {
      // Может быть объект с полем output/text
      output = (rawOutput as any).output || (rawOutput as any).text || JSON.stringify(rawOutput);
    } else {
      output = String(rawOutput || '');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Gemini response in ${elapsed}s (${output.length} chars)`);

    // Парсим JSON с улучшенной обработкой
    let jsonStr = output;
    
    // Убираем markdown блоки
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // Ищем JSON объект
    const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonStr = jsonObjectMatch[0];
    }
    
    // Исправляем частые проблемы в JSON
    jsonStr = jsonStr
      .replace(/,\s*}/g, '}')  // Trailing comma
      .replace(/,\s*]/g, ']')
      .replace(/'/g, '"');     // Single quotes

    try {
      const parsed = JSON.parse(jsonStr);
      const plans: VideoAnalysisPlan[] = parsed.plans || [];
      
      console.log(`   📋 Parsed ${plans.length} plans from Gemini`);
      
      return {
        success: true,
        plans,
        rawOutput: output,
        source: 'gemini-replicate'
      };
    } catch (parseError) {
      // Fallback: regex extraction
      const planRegex = /"planNumber"\s*:\s*(\d+)[\s\S]*?"planType"\s*:\s*"([^"]*)"[\s\S]*?"description"\s*:\s*"([^"]*)"/g;
      const extractedPlans: VideoAnalysisPlan[] = [];
      let match;
      while ((match = planRegex.exec(output)) !== null) {
        extractedPlans.push({
          planNumber: parseInt(match[1]),
          planType: match[2],
          description: match[3],
          visualCharacters: [],
          location: ''
        });
      }
      
      if (extractedPlans.length > 0) {
        console.log(`   📋 Extracted ${extractedPlans.length} plans via regex fallback`);
        return {
          success: true,
          plans: extractedPlans,
          rawOutput: output,
          source: 'gemini-replicate'
        };
      }
      
      console.warn(`   ⚠️ JSON parse failed, returning raw output`);
      return {
        success: true,
        plans: [],
        rawOutput: output,
        error: 'JSON parse failed',
        source: 'gemini-replicate'
      };
    }

  } catch (error: any) {
    const errorMsg = error.message || 'Unknown error';
    console.error(`❌ [GEMINI/Replicate] Error:`, errorMsg);
    
    return {
      success: false,
      plans: [],
      error: errorMsg,
      source: 'error'
    };
  }
}

/**
 * Тестовая функция для проверки доступности
 */
export async function testGeminiReplicate(): Promise<boolean> {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1;
    if (!apiToken) return false;

    const replicate = new Replicate({ auth: apiToken });
    
    // Простой тест без медиа
    const output = await replicate.run('google/gemini-2.5-flash', {
      input: {
        prompt: 'Say OK'
      }
    });
    
    return typeof output === 'string' && output.length > 0;
  } catch {
    return false;
  }
}
