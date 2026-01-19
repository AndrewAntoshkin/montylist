/**
 * Voice Embeddings — Голосовые отпечатки для точной идентификации персонажей
 * 
 * Использует Python worker с resemblyzer для создания voice embeddings.
 * Позволяет точно определить, кто говорит, сравнивая голоса.
 * 
 * @author AI Assistant
 * @version 1.0
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface VoiceEmbedding {
  speakerId: string;
  embedding: number[];
  confidence: number;
}

export interface VoiceMatch {
  character: string;
  confidence: number;
  method: 'voice_embedding';
}

export interface VoiceEmbeddingResult {
  embeddings: Record<string, number[]>;
  speaker_count: number;
  similarities?: Record<string, Record<string, number>>;
  matches?: Record<string, VoiceMatch>;
}

export interface DiarizationWord {
  text?: string;
  word?: string;
  speaker?: string;
  startMs?: number;
  endMs?: number;
  start?: number;
  end?: number;
}

/**
 * Создаёт голосовые отпечатки для каждого speaker ID
 */
export async function createVoiceEmbeddings(
  videoPath: string,
  diarizationWords: DiarizationWord[],
  referenceEmbeddings?: Record<string, number[]>
): Promise<VoiceEmbeddingResult> {
  console.log('\n' + '═'.repeat(60));
  console.log('🎤 VOICE EMBEDDINGS (Python Worker)');
  console.log('═'.repeat(60));
  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Words: ${diarizationWords.length}`);
  
  const workerPath = path.join(process.cwd(), 'scripts', 'voice-embedding-worker.py');
  
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Voice embedding worker not found: ${workerPath}`);
  }
  
  // Создаём временные файлы для данных
  const tempDir = os.tmpdir();
  const diarizationPath = path.join(tempDir, `diarization_${Date.now()}.json`);
  const referencePath = referenceEmbeddings 
    ? path.join(tempDir, `reference_${Date.now()}.json`)
    : null;
  
  try {
    // Записываем данные диаризации
    fs.writeFileSync(diarizationPath, JSON.stringify(diarizationWords));
    
    if (referenceEmbeddings && referencePath) {
      fs.writeFileSync(referencePath, JSON.stringify(referenceEmbeddings));
    }
    
    // Запускаем Python worker
    const args = [workerPath, videoPath, diarizationPath];
    if (referencePath) {
      args.push(referencePath);
    }
    
    return new Promise((resolve, reject) => {
      const worker = spawn('python3', args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      
      worker.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Показываем прогресс (кроме JSON результата)
        if (!text.includes('__RESULT_JSON__')) {
          process.stdout.write(text);
        }
      });
      
      worker.stderr.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
      
      worker.on('close', (code) => {
        // Очищаем временные файлы
        try {
          fs.unlinkSync(diarizationPath);
          if (referencePath && fs.existsSync(referencePath)) {
            fs.unlinkSync(referencePath);
          }
        } catch {}
        
        if (code !== 0) {
          reject(new Error(`Voice embedding worker failed with code ${code}\n${stderr}`));
          return;
        }
        
        // Парсим JSON результат
        const jsonMarker = '__RESULT_JSON__';
        const jsonStart = stdout.indexOf(jsonMarker);
        
        if (jsonStart === -1) {
          reject(new Error('No result JSON found in worker output'));
          return;
        }
        
        try {
          const jsonStr = stdout.slice(jsonStart + jsonMarker.length).trim();
          const result = JSON.parse(jsonStr) as VoiceEmbeddingResult;
          
          console.log(`\n✅ Voice embeddings created for ${result.speaker_count} speakers`);
          
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse worker result: ${parseError}`));
        }
      });
      
      worker.on('error', (err) => {
        reject(new Error(`Failed to start voice embedding worker: ${err.message}`));
      });
    });
    
  } catch (error) {
    // Очищаем в случае ошибки
    try {
      if (fs.existsSync(diarizationPath)) fs.unlinkSync(diarizationPath);
      if (referencePath && fs.existsSync(referencePath)) fs.unlinkSync(referencePath);
    } catch {}
    throw error;
  }
}

/**
 * Сохраняет эталонные голосовые отпечатки персонажей
 */
export function saveReferenceEmbeddings(
  embeddings: Record<string, number[]>,
  characterMapping: Record<string, string>,
  outputPath: string
): void {
  const referenceEmbeddings: Record<string, number[]> = {};
  
  for (const [speakerId, embedding] of Object.entries(embeddings)) {
    const characterName = characterMapping[speakerId];
    if (characterName) {
      referenceEmbeddings[characterName] = embedding;
    }
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(referenceEmbeddings, null, 2));
  console.log(`💾 Saved ${Object.keys(referenceEmbeddings).length} reference embeddings to ${outputPath}`);
}

/**
 * Улучшает speaker→character mapping используя voice embeddings
 */
export function refineSpeakerMapping(
  currentMapping: Record<string, string>,
  voiceMatches: Record<string, VoiceMatch>,
  confidenceThreshold: number = 0.8
): Record<string, string> {
  const refinedMapping = { ...currentMapping };
  
  for (const [speakerId, match] of Object.entries(voiceMatches)) {
    if (match.confidence >= confidenceThreshold) {
      const oldChar = currentMapping[speakerId];
      if (oldChar !== match.character) {
        console.log(`   🔄 Refined: ${speakerId} ${oldChar} → ${match.character} (${(match.confidence * 100).toFixed(0)}%)`);
        refinedMapping[speakerId] = match.character;
      }
    }
  }
  
  return refinedMapping;
}

/**
 * Вычисляет cosine similarity между двумя embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
