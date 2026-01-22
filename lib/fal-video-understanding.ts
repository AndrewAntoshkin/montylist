/**
 * fal.ai Video Understanding Integration
 * 
 * Замена Replicate Gemini для визуального анализа видео
 * Работает без гео-ограничений!
 * 
 * Улучшения:
 * - Exponential backoff для retry
 * - Максимум 2 retry попытки
 * - Детальное логирование ошибок
 */

import { fal } from '@fal-ai/client';
import { FAL_TIMEOUT_MS } from '@/lib/config';

// Конфигурация - API ключ ОБЯЗАТЕЛЕН
const FAL_CREDENTIALS = process.env.FAL_API_KEY;

if (!FAL_CREDENTIALS) {
  console.warn('⚠️ FAL_API_KEY not set - FAL.ai video analysis will be unavailable');
}

fal.config({
  credentials: FAL_CREDENTIALS || ''
});

// Retry configuration
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 2000; // 2 секунды
const BACKOFF_MULTIPLIER = 2;    // 2s → 4s

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
}

/**
 * Анализирует видео чанк и возвращает визуальные описания планов
 */
export async function analyzeVideoChunk(
  videoUrl: string,
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  characters: Array<{ name: string; description?: string; attributes?: any }>,
  scriptScenes?: Array<{ sceneNumber: string; location: string; characters: string[]; description?: string }>
): Promise<VideoAnalysisResult> {
  
  const characterList = characters.slice(0, 15).map(c => {
    const attrs = c.attributes ? ` (Пол: ${c.attributes.gender}, Возраст: ${c.attributes.ageRange}, Волосы: ${c.attributes.hairColor})` : '';
    return `- ${c.name}${attrs}${c.description ? `: ${c.description}` : ''}`;
  }).join('\n');

  let sceneContext = '';
  if (scriptScenes && scriptScenes.length > 0) {
    const relevantScenes = scriptScenes.slice(0, 5).map(s => {
      const chars = s.characters?.length > 0 ? s.characters.join(', ') : 'не указаны';
      return `  • Сцена ${s.sceneNumber} (${s.location}): Персонажи: ${chars}. Описание: ${s.description || 'нет'}`;
    }).join('\n');
    sceneContext = `\nКОНТЕКСТ СЦЕНАРИЯ (ближайшие сцены):\n${relevantScenes}\n`;
  }

  const prompt = `Ты профессиональный монтажёр. Проанализируй видео и определи КТО находится в кадре.

👥 ПЕРСОНАЖИ ФИЛЬМА (используй для идентификации):
${characterList || 'не указаны'}
${sceneContext}
📝 ЗАДАЧА - ДЛЯ КАЖДОГО ПЛАНА:

1. ОПИШИ ЛЮДЕЙ В КАДРЕ детально:
   - Пол, примерный возраст
   - Телосложение (крупная, худая, высокий, низкий)
   - Волосы (блондинка, брюнет, рыжая, лысый)
   - Этнические признаки (араб, славянка, смуглый)
   - Одежда, украшения (золотые браслеты, чёрный костюм)

2. СОПОСТАВЬ с персонажами:
   - Крупная блондинка с золотом → ГАЛИНА
   - Невысокий смуглый мужчина → ЮСЕФ
   - Молодой араб с платком → МОХАММЕД
   - Женщины в униформе → работницы салона

3. КТО ГОВОРИТ (по движению губ, жестам)

🎬 ПЛАНЫ ДЛЯ АНАЛИЗА (${scenes.length} планов):
${scenes.slice(0, 10).map((s, i) => `${i + 1}. ${s.start_timecode} - ${s.end_timecode}`).join('\n')}
${scenes.length > 10 ? `... и ещё ${scenes.length - 10} планов (проанализируй ВСЁ видео)` : ''}

✅ ФОРМАТ JSON:
{
  "plans": [
    {
      "planNumber": 1,
      "planType": "Ср.",
      "description": "Крупная блондинка с золотыми браслетами сидит в кресле",
      "visualDescription": "женщина ~27 лет, полная, светлые волосы, много золотых украшений",
      "visualCharacters": ["ГАЛИНА"],
      "location": "салон красоты",
      "speakingCharacter": "ГАЛИНА"
    }
  ]
}

ВАЖНО: Если видишь человека, соответствующего описанию персонажа — укажи ИМЯ. Иначе опиши внешность.
Ответь ТОЛЬКО JSON!`;

  // Helper function to make FAL request with timeout
  const makeFalRequest = async (requestPrompt: string, attempt: number): Promise<any> => {
    let lastStatus = '';
    const startTime = Date.now();
    
    const falPromise = fal.subscribe('fal-ai/video-understanding', {
      input: {
        video_url: videoUrl,
        prompt: requestPrompt
      },
      logs: false,
      onQueueUpdate: (update) => {
        if (update.status !== lastStatus) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (update.status === 'IN_QUEUE') {
            console.log(`   ⏳ FAL: In queue... (${elapsed}s)${attempt > 0 ? ` [retry ${attempt}]` : ''}`);
          } else if (update.status === 'IN_PROGRESS') {
            console.log(`   🔄 FAL: Processing... (${elapsed}s)${attempt > 0 ? ` [retry ${attempt}]` : ''}`);
          }
          lastStatus = update.status;
        }
      }
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`FAL timeout after ${FAL_TIMEOUT_MS/1000}s`)), FAL_TIMEOUT_MS);
    });
    
    return Promise.race([falPromise, timeoutPromise]);
  };

  // Helper function to parse FAL response with improved robustness
  const parseFalResponse = (output: string): { success: boolean; plans: VideoAnalysisPlan[]; rawOutput: string; error?: string } => {
    // Попытка 1: Убираем markdown блоки
    let jsonStr = output;
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // Попытка 2: Ищем JSON объект { ... } в тексте
    const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonStr = jsonObjectMatch[0];
    }

    // Попытка 3: Исправляем частые проблемы в JSON
    jsonStr = jsonStr
      .replace(/,\s*}/g, '}')  // Trailing comma before }
      .replace(/,\s*]/g, ']')  // Trailing comma before ]
      .replace(/'/g, '"')      // Single quotes → double quotes
      .replace(/\n/g, ' ')     // Newlines → spaces (внутри строк)
      .replace(/\t/g, ' ');    // Tabs → spaces

    try {
      const parsed = JSON.parse(jsonStr);
      const plans: VideoAnalysisPlan[] = parsed.plans || [];
      console.log(`   📋 Parsed ${plans.length} plans from JSON`);
      return { success: true, plans, rawOutput: output };
    } catch (e1) {
      // Попытка 4: Ищем массив plans напрямую
      const plansArrayMatch = output.match(/"plans"\s*:\s*\[([\s\S]*?)\]/);
      if (plansArrayMatch) {
        try {
          const arrStr = `[${plansArrayMatch[1]}]`
            .replace(/,\s*]/g, ']')
            .replace(/'/g, '"');
          const plans = JSON.parse(arrStr);
          console.log(`   📋 Parsed ${plans.length} plans from plans array match`);
          return { success: true, plans, rawOutput: output };
        } catch {
          // Continue to fallback
        }
      }
      
      // Попытка 5: Regex extraction для отдельных plan объектов
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
        return { success: true, plans: extractedPlans, rawOutput: output };
      }
      
      console.warn(`   ⚠️ JSON parse failed, returning raw output`);
      return { success: true, plans: [], rawOutput: output, error: 'JSON parse failed' };
    }
  };

  // Check if error is retryable
  const isRetryableError = (errorMsg: string): boolean => {
    const retryablePatterns = [
      'Unprocessable Entity',
      'timeout',
      '503',
      '502',
      '429',
      'rate limit',
      'ECONNRESET',
      'ETIMEDOUT',
      'Failed to download video',
    ];
    return retryablePatterns.some(pattern => errorMsg.toLowerCase().includes(pattern.toLowerCase()));
  };

  console.log(`🎬 [FAL] Analyzing video: ${videoUrl.slice(0, 80)}...`);
  console.log(`   Scenes: ${scenes.length}, Characters: ${characters.length}`);
  
  let lastError: string = '';
  
  // Main request + retries with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use simplified prompt on retries
      const currentPrompt = attempt === 0 ? prompt : 
        `Опиши что происходит в видео. Формат JSON: {"plans": [{"planNumber": 1, "planType": "Ср.", "description": "описание"}]}`;
      
      const result = await makeFalRequest(currentPrompt, attempt);
      const output = (result.data as any)?.output || '';
      
      if (!output) {
        throw new Error('Empty response from FAL');
      }
      
      console.log(`   ✅ FAL response received (${output.length} chars)${attempt > 0 ? ` [retry ${attempt}]` : ''}`);
      return parseFalResponse(output);
      
    } catch (error: any) {
      lastError = error.message || 'Unknown error';
      
      if (attempt < MAX_RETRIES && isRetryableError(lastError)) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt);
        console.log(`   ⚠️ FAL error: ${lastError.slice(0, 80)}`);
        console.log(`   🔄 Retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs/1000}s (exponential backoff)...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        // Non-retryable error or max retries reached
        break;
      }
    }
  }
  
  // All retries failed
  console.error(`❌ [FAL] All attempts failed. Last error: ${lastError}`);
  return {
    success: false,
    plans: [],
    error: lastError
  };
}

/**
 * Простой тест подключения
 */
export async function testFalConnection(): Promise<boolean> {
  try {
    const result = await fal.subscribe('fal-ai/any-llm', {
      input: {
        model: 'google/gemini-flash-1.5',
        prompt: 'Say OK'
      }
    });
    return !!(result.data as any)?.output;
  } catch {
    return false;
  }
}
