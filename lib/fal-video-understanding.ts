/**
 * fal.ai Video Understanding Integration
 * 
 * Замена Replicate Gemini для визуального анализа видео
 * Работает без гео-ограничений!
 */

import { fal } from '@fal-ai/client';

// Конфигурация
const FAL_CREDENTIALS = process.env.FAL_API_KEY || '89dceaa8-2e49-40f3-ad05-be403157f122:fb36fcd072592bfe0b732b797ec17e20';

fal.config({
  credentials: FAL_CREDENTIALS
});

export interface VideoAnalysisPlan {
  planNumber: number;
  planType: string;
  description: string;
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

  const prompt = `Ты профессиональный монтажёр. Проанализируй видео и опиши ВИЗУАЛЬНУЮ ИНФОРМАЦИЮ для каждого плана.

ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ (с описаниями):
${characterList || 'не указаны'}
${sceneContext}
ВАЖНО:
- Описывай ТОЛЬКО что ВИДНО в кадре
- Определяй тип плана: Кр. (крупный), Ср. (средний), Общ. (общий), Деталь
- Если можешь определить говорящего персонажа по ВИЗУАЛЬНЫМ признакам (лицо, одежда, контекст), укажи его в speakingCharacter
- Отвечай на РУССКОМ языке

ПЛАНЫ ДЛЯ АНАЛИЗА:
${scenes.map((s, i) => `План ${i + 1}: ${s.start_timecode} - ${s.end_timecode}`).join('\n')}

ФОРМАТ ОТВЕТА (JSON):
{
  "plans": [
    {
      "planNumber": 1,
      "planType": "Ср.",
      "description": "Женщина в золотом платье стоит у стойки ресепшн",
      "visualCharacters": ["женщина в золотом", "мужчина в костюме"],
      "location": "холл салона",
      "speakingCharacter": "ГАЛИНА"
    }
  ]
}

Ответь ТОЛЬКО JSON, без markdown блоков.`;

  try {
    console.log(`🎬 [FAL] Analyzing video: ${videoUrl.slice(0, 80)}...`);
    console.log(`   Scenes: ${scenes.length}, Characters: ${characters.length}`);
    
    // Таймаут 10 минут для длинных видео (3-минутные чанки могут обрабатываться долго)
    const FAL_TIMEOUT = 600000; // 10 минут
    
    // Компактное логирование со счётчиком
    let updateCount = 0;
    let lastStatus = '';
    const startTime = Date.now();
    
    const falPromise = fal.subscribe('fal-ai/video-understanding', {
      input: {
        video_url: videoUrl,
        prompt: prompt
      },
      logs: false,
      onQueueUpdate: (update) => {
        updateCount++;
        // Логируем только при смене статуса
        if (update.status !== lastStatus) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (update.status === 'IN_QUEUE') {
            console.log(`   ⏳ FAL: In queue... (${elapsed}s)`);
          } else if (update.status === 'IN_PROGRESS') {
            console.log(`   🔄 FAL: Processing... (${elapsed}s)`);
          }
          lastStatus = update.status;
        }
      }
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`FAL timeout after ${FAL_TIMEOUT/1000}s`)), FAL_TIMEOUT);
    });
    
    const result = await Promise.race([falPromise, timeoutPromise]) as any;

    const output = (result.data as any)?.output || '';
    console.log(`   ✅ FAL response received (${output.length} chars)`);

    // Парсим JSON из ответа
    let jsonStr = output;
    
    // Убираем markdown блоки если есть
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // Пробуем найти JSON объект
    const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonStr = jsonObjectMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      const plans: VideoAnalysisPlan[] = parsed.plans || [];
      
      console.log(`   📋 Parsed ${plans.length} plans`);
      
      return {
        success: true,
        plans,
        rawOutput: output
      };
    } catch (parseError) {
      console.warn(`   ⚠️ JSON parse failed, returning raw output`);
      return {
        success: true,
        plans: [],
        rawOutput: output,
        error: 'JSON parse failed'
      };
    }

  } catch (error: any) {
    const errorMsg = error.message || 'Unknown error';
    
    // Retry для некоторых ошибок
    if (errorMsg.includes('Unprocessable Entity') || errorMsg.includes('timeout') || errorMsg.includes('503')) {
      console.log(`   ⚠️ FAL error: ${errorMsg}, retrying in 5s...`);
      
      // Ждём 5 сек и пробуем ещё раз (с меньшим промптом)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const retryResult = await fal.subscribe('fal-ai/video-understanding', {
          input: {
            video_url: videoUrl,
            prompt: `Опиши что происходит в видео. Формат JSON: {"plans": [{"planNumber": 1, "planType": "Ср.", "description": "..."}]}`
          },
          logs: false,
        });
        
        const retryOutput = (retryResult.data as any)?.output || '';
        if (retryOutput) {
          console.log(`   ✅ FAL retry successful (${retryOutput.length} chars)`);
          const parsed = JSON.parse(retryOutput.match(/\{[\s\S]*\}/)?.[0] || '{}');
          return { success: true, plans: parsed.plans || [], rawOutput: retryOutput };
        }
      } catch (retryError: any) {
        console.error(`   ❌ FAL retry also failed:`, retryError.message);
      }
    }
    
    console.error(`❌ [FAL] Error:`, errorMsg);
    return {
      success: false,
      plans: [],
      error: errorMsg
    };
  }
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
