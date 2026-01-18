/**
 * Direct Preprocess Audio Function
 * 
 * Вызывается напрямую из complete-upload без HTTP fetch.
 * Выполняет полную диаризацию аудио ПЕРЕД нарезкой на чанки.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  performFullDiarization,
  serializeDiarization,
  estimateCost,
  type VideoDiarizationData,
} from '@/lib/full-audio-diarization';

export interface PreprocessAudioParams {
  videoId: string;
  audioUrl: string;
  characters?: Array<{ name?: string }>;
}

export interface PreprocessAudioResult {
  success: boolean;
  speakers?: string[];
  speakerCount?: number;
  wordCount?: number;
  duration?: number;
  processingTime?: number;
  error?: string;
  cached?: boolean;
}

/**
 * Выполняет полную диаризацию аудио (без HTTP)
 */
export async function runPreprocessAudio(
  params: PreprocessAudioParams
): Promise<PreprocessAudioResult> {
  const { videoId, audioUrl, characters } = params;
  const startTime = Date.now();

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`🎤 PRE-PROCESS AUDIO STARTED (direct): ${videoId}`);
  console.log(`════════════════════════════════════════════════════════════`);

  const supabase = createServiceRoleClient();

  // Проверяем что видео существует (с retry из-за race condition)
  let video = null;
  let videoError = null;

  console.log(`   🔍 Looking for video: ${videoId}`);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await supabase
      .from('videos')
      .select('id, duration, status, original_filename')
      .eq('id', videoId)
      .single();

    video = result.data;
    videoError = result.error;

    console.log(`   🔍 Attempt ${attempt}: data=${!!video}, error=${videoError?.message || 'none'}`);

    if (video) break;

    console.log(`   ⏳ Video not ready yet, retry ${attempt}/5...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  if (videoError || !video) {
    console.error(`❌ Video not found after retries: ${videoId}, error: ${videoError?.message}`);
    return { success: false, error: 'Video not found' };
  }

  console.log(`   ✅ Video found: ${video.original_filename || video.id}`);

  // Проверяем не обработано ли уже
  const { data: existingData } = await supabase
    .from('videos')
    .select('full_diarization')
    .eq('id', videoId)
    .single();

  if (existingData?.full_diarization) {
    console.log(`   ⚠️ Full diarization already exists, skipping...`);
    return { success: true, cached: true };
  }

  // Оцениваем стоимость
  const duration = video.duration || 0;
  const estimatedCost = estimateCost(duration);
  console.log(`   📊 Video duration: ${(duration / 60).toFixed(1)} min`);
  console.log(`   💰 Estimated cost: $${estimatedCost.toFixed(2)}`);

  // Извлекаем имена персонажей для word boost
  const characterNames = (characters || [])
    .map((c: { name?: string }) => c.name)
    .filter(Boolean)
    .slice(0, 20) as string[];

  console.log(`   👥 Character hints: ${characterNames.slice(0, 5).join(', ')}...`);

  // Выполняем полную диаризацию
  try {
    const diarizationResult = await performFullDiarization(
      audioUrl,
      'ru',
      characterNames,
      10
    );

    // Сохраняем результат
    const diarizationData: VideoDiarizationData = {
      videoId,
      result: diarizationResult,
      speakerMapping: [],
      createdAt: Date.now(),
    };

    const { error: updateError } = await supabase
      .from('videos')
      .update({ full_diarization: serializeDiarization(diarizationData) })
      .eq('id', videoId);

    if (updateError) {
      console.error(`   ❌ Failed to save diarization:`, updateError);
      return { success: false, error: 'Failed to save diarization' };
    }

    const totalTime = (Date.now() - startTime) / 1000;

    console.log(`\n✅ PRE-PROCESSING COMPLETE:`);
    console.log(`   Words: ${diarizationResult.words.length}`);
    console.log(`   Speakers: ${diarizationResult.speakers.join(', ')}`);
    console.log(`   Duration: ${(diarizationResult.totalDuration / 60).toFixed(1)} min`);
    console.log(`   Time taken: ${totalTime.toFixed(1)}s`);

    return {
      success: true,
      speakers: diarizationResult.speakers,
      speakerCount: diarizationResult.speakerCount,
      wordCount: diarizationResult.words.length,
      duration: diarizationResult.totalDuration,
      processingTime: totalTime,
    };
  } catch (diarizationError) {
    console.error(`   ❌ Diarization failed:`, diarizationError);

    await supabase
      .from('videos')
      .update({ processing_error: `Diarization failed: ${diarizationError}` })
      .eq('id', videoId);

    return { success: false, error: String(diarizationError) };
  }
}
