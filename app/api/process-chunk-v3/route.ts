/**
 * Process Chunk V3 — упрощённая обработка
 * 
 * Отличия от v2:
 * - Простой промпт (prompts-v3)
 * - Markdown ответ (не JSON)
 * - Меньше слоёв обработки
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { updateChunkStatus } from '@/lib/supabase/chunk-status';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { timecodeToSeconds } from '@/lib/video-chunking';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';
import { getReplicatePool } from '@/lib/replicate-pool';
import { type ParsedScene } from '@/types';
import { type MergedScene } from '@/lib/credits-detector';
import { createChunkPromptV3, formatCharactersForPrompt, parseResponseV3 } from '@/lib/prompts-v3';

const AI_MODEL = 'google/gemini-3-pro';
const MAX_PREDICTION_ATTEMPTS = 5;

// 5 minutes timeout
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let videoId: string | undefined;
  let chunkIndex: number | undefined;
  
  try {
    const body = await request.json();
    videoId = body.videoId;
    chunkIndex = body.chunkIndex;
    const chunkStorageUrl = body.chunkStorageUrl;
    const startTimecode = body.startTimecode;
    const endTimecode = body.endTimecode;

    if (!videoId || chunkIndex === undefined || !chunkStorageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 V3 CHUNK ${chunkIndex}: ${startTimecode} - ${endTimecode}`);
    console.log(`${'═'.repeat(60)}`);

    const supabase = createServiceRoleClient();

    // Get video data
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json, user_id')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    const chunkProgress = video.chunk_progress_json;
    if (!chunkProgress || !chunkProgress.chunks[chunkIndex]) {
      throw new Error('Chunk progress not found');
    }

    const totalChunks: number = chunkProgress.totalChunks || chunkProgress.chunks.length;

    // Update status
    await updateChunkStatus(videoId, chunkIndex, 'processing');

    // Get scenes for this chunk
    const allMergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    const chunkStartSeconds = timecodeToSeconds(startTimecode);
    const chunkEndSeconds = timecodeToSeconds(endTimecode);
    
    const chunkScenes = allMergedScenes.filter(s => 
      s.start_timestamp >= chunkStartSeconds - 1 && 
      s.start_timestamp < chunkEndSeconds
    );
    
    console.log(`📐 Scenes in chunk: ${chunkScenes.length}`);

    // Prepare character registry
    let characterRegistry = '';
    const scriptData = chunkProgress.scriptData;
    if (scriptData?.characters?.length > 0) {
      characterRegistry = formatCharactersForPrompt(scriptData.characters);
      console.log(`📋 Characters from script: ${scriptData.characters.length}`);
    }

    // Build scene boundaries for prompt
    const sceneBoundaries = chunkScenes.map(s => ({
      start_timecode: s.start_timecode,
      end_timecode: s.end_timecode,
    }));

    // Create V3 prompt
    const isFirstChunk = chunkIndex === 0;
    const isLastChunk = chunkIndex === totalChunks - 1;
    
    const prompt = createChunkPromptV3(
      sceneBoundaries,
      chunkIndex,
      totalChunks,
      isFirstChunk,
      isLastChunk,
      characterRegistry
    );
    
    console.log(`📝 V3 Prompt: ${prompt.length} chars (vs ~5000+ in v2)`);

    // Get Replicate client
    const pool = getReplicatePool();
    const { client: replicate, keyIndex, release } = await pool.getLeastLoadedClient();

    let completedPrediction: Awaited<ReturnType<typeof pollPrediction>> | null = null;

    try {
      for (let attempt = 1; attempt <= MAX_PREDICTION_ATTEMPTS; attempt++) {
        try {
          console.log(`🚀 Prediction attempt ${attempt}/${MAX_PREDICTION_ATTEMPTS} (key #${keyIndex})`);
          
          const prediction = await createPredictionWithRetry(
            replicate,
            AI_MODEL,
            {
              videos: [chunkStorageUrl],
              prompt,
            }
          );

          console.log(`⏳ Polling ${prediction.id}...`);
          completedPrediction = await pollPrediction(replicate, prediction.id);

          if (completedPrediction.status === 'failed') {
            throw new Error(`Prediction failed: ${completedPrediction.error}`);
          }

          break;
        } catch (predictionError) {
          const message = predictionError instanceof Error ? predictionError.message : String(predictionError);
          const isTemporary = message.includes('E6716') || message.includes('E004') || message.includes('timeout');

          if (isTemporary && attempt < MAX_PREDICTION_ATTEMPTS) {
            const backoffMs = Math.min(Math.pow(attempt, 2) * 5000, 90000);
            console.warn(`⚠️ Temporary error, retry in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }

          throw predictionError;
        }
      }
    } finally {
      release();
    }

    if (!completedPrediction) {
      throw new Error('Prediction did not complete');
    }

    const output = completedPrediction.output;
    const aiResponse = Array.isArray(output) ? output.join('') : String(output);
    console.log(`✅ AI response: ${aiResponse.length} chars`);
    
    // Log first 800 chars for debugging
    console.log(`\n🔍 AI Response preview:\n${'─'.repeat(60)}`);
    console.log(aiResponse.substring(0, 800));
    console.log(`${'─'.repeat(60)}\n`);
    
    if (aiResponse.length === 0) {
      throw new Error('Empty response from AI');
    }

    // Parse V3 response (markdown format)
    console.log(`\n📝 Parsing V3 markdown response...`);
    let parsedScenes = parseResponseV3(aiResponse);
    
    console.log(`📊 Parsed ${parsedScenes.length} scenes from markdown`);
    
    // If markdown parsing failed, try fallback
    if (parsedScenes.length === 0) {
      console.warn(`⚠️ Markdown parsing failed, trying fallback...`);
      // Import legacy parser as fallback
      const { parseGeminiResponse } = await import('@/lib/parseGeminiResponse');
      const fallbackScenes = parseGeminiResponse(aiResponse);
      
      parsedScenes = fallbackScenes.map(s => ({
        start_timecode: s.start_timecode,
        end_timecode: s.end_timecode,
        plan_type: s.plan_type || 'Ср.',
        description: s.description || '',
        dialogues: s.dialogues || 'Музыка',
      }));
      
      console.log(`📊 Fallback parsed ${parsedScenes.length} scenes`);
    }

    // Match AI content to FFmpeg timecodes
    // V3: Простое сопоставление по порядку (если количество совпадает)
    let finalScenes: ParsedScene[];
    
    if (sceneBoundaries.length > 0 && parsedScenes.length > 0) {
      if (parsedScenes.length === sceneBoundaries.length) {
        // Идеальный случай: количество совпадает — сопоставляем по порядку
        console.log(`✅ Perfect match: ${parsedScenes.length} AI = ${sceneBoundaries.length} FFmpeg`);
        finalScenes = sceneBoundaries.map((b, idx) => ({
          timecode: `${b.start_timecode} - ${b.end_timecode}`,
          start_timecode: b.start_timecode,
          end_timecode: b.end_timecode,
          plan_type: parsedScenes[idx]?.plan_type || 'Ср.',
          description: parsedScenes[idx]?.description || '',
          dialogues: parsedScenes[idx]?.dialogues || 'Музыка',
        }));
      } else {
        // Количество не совпадает — используем таймкоды AI напрямую
        console.warn(`⚠️ Mismatch: ${parsedScenes.length} AI vs ${sceneBoundaries.length} FFmpeg`);
        finalScenes = parsedScenes.map(s => ({
          timecode: `${s.start_timecode} - ${s.end_timecode}`,
          start_timecode: s.start_timecode,
          end_timecode: s.end_timecode,
          plan_type: s.plan_type || 'Ср.',
          description: s.description || '',
          dialogues: s.dialogues || 'Музыка',
        }));
      }
    } else {
      // Нет FFmpeg сцен — используем AI напрямую
      finalScenes = parsedScenes.map(s => ({
        timecode: `${s.start_timecode} - ${s.end_timecode}`,
        start_timecode: s.start_timecode,
        end_timecode: s.end_timecode,
        plan_type: s.plan_type || 'Ср.',
        description: s.description || '',
        dialogues: s.dialogues || 'Музыка',
      }));
    }

    // Filter scenes within chunk range
    const validScenes = finalScenes.filter(scene => {
      const sceneStart = timecodeToSeconds(scene.start_timecode);
      return sceneStart >= (chunkStartSeconds - 1) && sceneStart < chunkEndSeconds;
    });

    console.log(`📊 Valid scenes in range: ${validScenes.length}`);

    // Get sheet ID
    const sheetId = chunkProgress.sheetId;
    if (!sheetId) {
      throw new Error('Sheet ID not found');
    }

    // Verify sheet exists
    const { data: existingSheet, error: sheetCheckError } = await supabase
      .from('montage_sheets')
      .select('id')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetCheckError || !existingSheet) {
      throw new Error(`Sheet ${sheetId} does not exist`);
    }

    // Get last plan number
    const { data: lastEntry } = await supabase
      .from('montage_entries')
      .select('plan_number, order_index')
      .eq('sheet_id', sheetId)
      .order('plan_number', { ascending: false })
      .limit(1);
    
    const lastPlanNumber = lastEntry?.[0]?.plan_number ?? 0;
    const lastOrderIndex = lastEntry?.[0]?.order_index ?? -1;

    // Insert entries
    const entriesToInsert = validScenes.map((scene, index) => ({
      sheet_id: sheetId,
      plan_number: lastPlanNumber + index + 1,
      order_index: lastOrderIndex + index + 1,
      start_timecode: scene.start_timecode,
      end_timecode: scene.end_timecode,
      plan_type: scene.plan_type || '',
      description: scene.description || '',
      dialogues: scene.dialogues || '',
    }));

    if (entriesToInsert.length > 0) {
      // Log first 3 entries for comparison with reference
      console.log(`\n📋 Sample entries (first 3 of ${entriesToInsert.length}):`);
      console.log('─'.repeat(80));
      for (const entry of entriesToInsert.slice(0, 3)) {
        console.log(`#${entry.plan_number} | ${entry.start_timecode} - ${entry.end_timecode} | ${entry.plan_type}`);
        console.log(`   📝 ${entry.description.substring(0, 100)}${entry.description.length > 100 ? '...' : ''}`);
        console.log(`   💬 ${entry.dialogues.substring(0, 80)}${entry.dialogues.length > 80 ? '...' : ''}`);
      }
      console.log('─'.repeat(80));
      
      const { error: insertError } = await supabase
        .from('montage_entries')
        .insert(entriesToInsert);

      if (insertError) {
        if (insertError.code === '23505') {
          console.warn(`⚠️  Duplicate entries (parallel processing)`);
        } else {
          throw new Error(`Insert failed: ${insertError.message}`);
        }
      }
    }

    // Update chunk status
    await updateChunkStatus(videoId, chunkIndex, 'completed');

    console.log(`\n✅ V3 CHUNK ${chunkIndex} COMPLETE: ${validScenes.length} scenes saved`);

    // Get updated progress
    const { data: updatedVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const updatedProgress = updatedVideo?.chunk_progress_json;

    return NextResponse.json({
      success: true,
      chunkIndex,
      scenesCount: validScenes.length,
      completedChunks: updatedProgress?.completedChunks || 0,
      totalChunks: updatedProgress?.totalChunks || totalChunks,
      processingVersion: 'v3',
    });

  } catch (error) {
    console.error('V3 Chunk Error:', error);
    
    if (videoId && chunkIndex !== undefined) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await updateChunkStatus(videoId, chunkIndex, 'failed', errorMessage);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

