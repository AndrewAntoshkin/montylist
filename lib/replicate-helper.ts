import Replicate from 'replicate';

/**
 * Helper для работы с Replicate с умной retry логикой
 * Использует exponential backoff для оптимальной производительности
 */
export async function createPredictionWithRetry(
  replicate: Replicate,
  model: string,
  input: any,
  maxRetries: number = 5 // Увеличено с 3 до 5
): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} to create prediction...`);
      
      const prediction = await replicate.predictions.create({
        model,
        input,
      });
      
      console.log(`✅ Prediction created successfully on attempt ${attempt}:`, prediction.id);
      return prediction;
    } catch (error: any) {
      lastError = error;
      console.error(`❌ Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      // Если это не последняя попытка, ждем перед retry
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 8s, 18s, 32s (max 30s)
        const exponentialWait = Math.pow(attempt, 2) * 2000;
        const waitTime = Math.min(exponentialWait, 30000);
        console.log(`⏳ Waiting ${waitTime}ms before retry (exponential backoff)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Failed to create prediction after all retries');
}

/**
 * Опрос статуса prediction с таймаутом и умным интервалом
 */
export async function pollPrediction(
  replicate: Replicate,
  predictionId: string,
  maxAttempts: number = 90, // Увеличено с 60 до 90 (7.5 минут вместо 5)
  pollInterval: number = 5000
): Promise<any> {
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const result = await replicate.predictions.get(predictionId);
      console.log(`Polling attempt ${attempts + 1}/${maxAttempts}:`, result.status);
      
      if (result.status === 'succeeded') {
        return result;
      }
      
      if (result.status === 'failed' || result.status === 'canceled') {
        const errorMsg = String(result.error || 'Unknown error');
        
        // Check if E6716 (temporary Replicate error)
        if (errorMsg.includes('E6716') || errorMsg.includes('Director: unexpected error')) {
          console.error(`⚠️  E6716 error detected. This is likely a temporary Replicate issue.`);
        }
        
        throw new Error(`Prediction ${result.status}: ${errorMsg}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;
    } catch (error: any) {
      // If prediction.get() itself fails (network error), retry
      if (error.message?.includes('fetch') || error.code === 'ECONNRESET') {
        console.warn(`⚠️  Network error polling prediction, retrying...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
        continue;
      }
      
      // Re-throw other errors
      throw error;
    }
  }
  
  throw new Error(`Prediction timed out after ${maxAttempts} attempts`);
}

