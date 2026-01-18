/**
 * OpenRouter API Integration
 * 
 * Использует Gemini 3 Flash Preview через OpenRouter
 * OpenAI-совместимый API без ограничений Files API
 */

// Модель: gemini-3-flash-preview — лучшая для видео
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

interface OpenRouterResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

/**
 * Скачивает видео и конвертирует в base64
 */
async function downloadVideoAsBase64(videoUrl: string): Promise<string> {
  console.log(`📥 Downloading video...`);
  
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  
  console.log(`   Size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
  
  return base64;
}

/**
 * Анализирует видео с помощью OpenRouter + Gemini
 * 
 * @param videoUrl - URL видео для анализа
 * @param prompt - Текстовый промпт
 * @param videoId - ID видео для логов
 * @param modelName - Название модели
 * @returns Ответ от API
 */
export async function analyzeVideoWithOpenRouter(
  videoUrl: string,
  prompt: string,
  videoId: string,
  modelName: string = DEFAULT_MODEL
): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set in environment');
  }
  
  console.log(`\n🌐 OpenRouter: Starting video analysis...`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Video ID: ${videoId}`);
  console.log(`   Prompt: ${prompt.length} chars`);
  
  try {
    // 1. Скачиваем видео как base64
    const videoBase64 = await downloadVideoAsBase64(videoUrl);
    
    // 2. Формируем запрос к OpenRouter
    console.log(`🧠 Sending to OpenRouter...`);
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://carete-montage.vercel.app',
        'X-Title': 'Carete Montage',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:video/mp4;base64,${videoBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 8000, // Уменьшено для бесплатного тарифа
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    const text = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;
    
    console.log(`✅ OpenRouter response received`);
    console.log(`   Text length: ${text.length} chars`);
    console.log(`   Tokens used: ${tokensUsed}`);
    
    return {
      text,
      tokensUsed,
      model: modelName,
    };
    
  } catch (error) {
    console.error(`❌ OpenRouter error:`, error);
    throw error;
  }
}

/**
 * Проверяет доступность OpenRouter API
 */
export async function checkOpenRouterAvailable(): Promise<boolean> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    console.warn('⚠️ OPENROUTER_API_KEY not set');
    return false;
  }
  
  console.log('✅ OpenRouter API key is set');
  return true;
}

