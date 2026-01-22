/**
 * Unified Video Analyzer - Gemini (primary) + FAL (fallback)
 * 
 * Архитектура с Circuit Breaker:
 * 1. Проверяем circuit breaker для Gemini
 * 2. Если открыт — сразу переходим на FAL
 * 3. Если закрыт — пробуем Gemini, при ошибке идём на FAL
 */

import { analyzeVideoWithGemini, type VideoAnalysisResult } from './gemini-replicate';
import { analyzeVideoChunk as analyzeWithFal } from './fal-video-understanding';
import { 
  geminiCircuitBreaker, 
  falCircuitBreaker,
  CircuitOpenError 
} from './circuit-breaker';

export async function analyzeVideo(
  videoUrl: string,
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  characters: Array<{ name: string; description?: string; attributes?: any }>,
  scriptScenes?: Array<{ sceneNumber: string; location: string; characters: string[]; description?: string }>
): Promise<VideoAnalysisResult> {
  
  console.log(`\n🎬 Video Analysis (Gemini → FAL fallback)...`);
  
  // 1. Check if Gemini circuit is open
  if (geminiCircuitBreaker.isOpen()) {
    console.log(`   ⚡ Gemini circuit OPEN, skipping to FAL...`);
  } else {
    // 2. Try Gemini on Replicate first
    try {
      const geminiResult = await analyzeVideoWithGemini(videoUrl, scenes, characters, scriptScenes);
      
      if (geminiResult.success && geminiResult.plans.length > 0) {
        geminiCircuitBreaker.recordSuccess();
        console.log(`   ✅ Gemini успешно вернул ${geminiResult.plans.length} планов`);
        return geminiResult;
      }
      
      // 0 планов — не считаем ошибкой, но переключаемся на FAL
      console.log(`   ⚠️ Gemini вернул 0 планов, переключаемся на FAL...`);
    } catch (geminiError: any) {
      geminiCircuitBreaker.recordFailure(geminiError.message);
      console.log(`   ⚠️ Gemini ошибка: ${geminiError.message}, переключаемся на FAL...`);
    }
  }
  
  // 3. Check if FAL circuit is open
  if (falCircuitBreaker.isOpen()) {
    console.log(`   ⚡ FAL circuit OPEN, returning empty result...`);
    return {
      success: false,
      plans: [],
      error: 'Both Gemini and FAL circuits are open',
      source: 'error'
    };
  }
  
  // 4. Fallback to FAL
  console.log(`   🔄 Используем FAL.ai как fallback...`);
  
  try {
    const falResult = await analyzeWithFal(videoUrl, scenes, characters, scriptScenes);
    
    if (falResult.success) {
      falCircuitBreaker.recordSuccess();
    } else {
      falCircuitBreaker.recordFailure(falResult.error || 'Unknown FAL error');
    }
    
    return {
      ...falResult,
      source: 'fal'
    };
  } catch (falError: any) {
    falCircuitBreaker.recordFailure(falError.message);
    console.log(`   ❌ FAL ошибка: ${falError.message}`);
    
    return {
      success: false,
      plans: [],
      error: falError.message,
      source: 'error'
    };
  }
}
