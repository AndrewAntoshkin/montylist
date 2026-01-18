/**
 * Google Gemini API Direct Integration
 * 
 * Прямой вызов Gemini без Replicate — свой лимит
 * Использует inline video data (base64)
 * Поддержка прокси через HTTPS_PROXY
 */

import { GoogleGenerativeAI, RequestOptions } from '@google/generative-ai';
import { ProxyAgent, setGlobalDispatcher, Agent } from 'undici';

// Модель: gemini-2.0-flash — работает глобально
const DEFAULT_MODEL = 'gemini-2.0-flash';

// Настраиваем глобальный прокси если есть
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
let proxyAgent: ProxyAgent | null = null;

if (proxyUrl) {
  console.log(`🌐 Using proxy: ${proxyUrl}`);
  proxyAgent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(proxyAgent);
}

interface GeminiVideoResponse {
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
 * Анализирует видео с помощью Gemini
 * 
 * @param videoUrl - URL видео для анализа
 * @param prompt - Текстовый промпт
 * @param videoId - ID видео для логов
 * @param modelName - Название модели (default: gemini-2.0-flash)
 * @returns Ответ от Gemini
 */
export async function analyzeVideoWithGemini(
  videoUrl: string,
  prompt: string,
  videoId: string,
  modelName: string = DEFAULT_MODEL
): Promise<GeminiVideoResponse> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY not set in environment');
  }
  
  console.log(`\n🤖 Gemini Direct: Starting video analysis...`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Video ID: ${videoId}`);
  console.log(`   Prompt: ${prompt.length} chars`);
  if (proxyUrl) {
    console.log(`   Proxy: ${proxyUrl}`);
  }
  
  try {
    // 1. Скачиваем видео как base64
    const videoBase64 = await downloadVideoAsBase64(videoUrl);
    
    // 2. Создаём клиент
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    // 3. Генерируем ответ с видео (inline data)
    console.log(`🧠 Generating response...`);
    
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'video/mp4',
          data: videoBase64,
        },
      },
      { text: prompt },
    ]);
    
    const response = result.response;
    const text = response.text();
    
    // Получаем usage metadata
    const usageMetadata = response.usageMetadata;
    const tokensUsed = usageMetadata?.totalTokenCount || 0;
    
    console.log(`✅ Gemini response received`);
    console.log(`   Text length: ${text.length} chars`);
    console.log(`   Tokens used: ${tokensUsed}`);
    
    return {
      text,
      tokensUsed,
      model: modelName,
    };
    
  } catch (error) {
    console.error(`❌ Gemini Direct error:`, error);
    throw error;
  }
}

/**
 * Проверяет доступность Google AI API
 */
export async function checkGoogleAIAvailable(): Promise<boolean> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.warn('⚠️ GOOGLE_AI_API_KEY not set');
    return false;
  }
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Простой тест — создание модели
    genAI.getGenerativeModel({ model: DEFAULT_MODEL });
    console.log('✅ Google AI API key is valid');
    return true;
  } catch (error) {
    console.error('❌ Google AI API check failed:', error);
    return false;
  }
}
