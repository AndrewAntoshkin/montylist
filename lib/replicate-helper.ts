import Replicate from 'replicate';

/**
 * Helper для работы с Replicate с retry логикой
 */
export async function createPredictionWithRetry(
  replicate: Replicate,
  model: string,
  input: any,
  maxRetries: number = 3
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
        const waitTime = attempt * 2000; // 2s, 4s, 6s...
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Failed to create prediction after all retries');
}

/**
 * Опрос статуса prediction с таймаутом
 */
export async function pollPrediction(
  replicate: Replicate,
  predictionId: string,
  maxAttempts: number = 60,
  pollInterval: number = 5000
): Promise<any> {
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const result = await replicate.predictions.get(predictionId);
    console.log(`Polling attempt ${attempts + 1}/${maxAttempts}:`, result.status);
    
    if (result.status === 'succeeded') {
      return result;
    }
    
    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Prediction ${result.status}: ${result.error || 'Unknown error'}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
  }
  
  throw new Error(`Prediction timed out after ${maxAttempts} attempts`);
}

