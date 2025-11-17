import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Replicate from 'replicate';
import { parseGeminiResponse, parseAlternativeFormat } from '@/lib/parseGeminiResponse';
import { createChunkPrompt } from '@/lib/gemini-prompt';
import { timecodeToSeconds, secondsToTimecode } from '@/lib/video-chunking';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// 5 minutes timeout per chunk
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Parse request body at the top level so we can access in catch block
  let videoId: string | undefined;
  let chunkIndex: number | undefined;
  
  try {
    const body = await request.json();
    videoId = body.videoId;
    chunkIndex = body.chunkIndex;
    const chunkStorageUrl = body.chunkStorageUrl;
    const startTimecode = body.startTimecode;
    const endTimecode = body.endTimecode;
    const filmMetadata = body.filmMetadata;

    if (!videoId || chunkIndex === undefined || !chunkStorageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: videoId, chunkIndex, chunkStorageUrl' },
        { status: 400 }
      );
    }

    console.log(`🎬 Processing chunk ${chunkIndex} for video ${videoId}`);
    console.log(`📹 Chunk: ${startTimecode} - ${endTimecode}`);

    const supabase = createServiceRoleClient();

    // Get video and chunk progress
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

    const totalChunks = chunkProgress.totalChunks || chunkProgress.chunks.length;

    // Update chunk status to processing
    chunkProgress.currentChunk = chunkIndex;
    chunkProgress.chunks[chunkIndex].status = 'processing';
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    // Create prompt for this chunk
    const prompt = createChunkPrompt(chunkIndex, startTimecode, endTimecode, totalChunks);
    console.log(`📝 Generated prompt for chunk ${chunkIndex}`);

    // Start Replicate prediction
    console.log(`🚀 Starting Replicate prediction for chunk ${chunkIndex}...`);
    const prediction = await createPredictionWithRetry(
      replicate,
      'google/gemini-2.5-flash',
      {
        video: chunkStorageUrl,
        prompt: prompt,
        max_tokens: 8096,
      }
    );

    console.log(`⏳ Polling prediction ${prediction.id} for chunk ${chunkIndex}...`);
    const completedPrediction = await pollPrediction(replicate, prediction.id);

    if (completedPrediction.status === 'failed') {
      throw new Error(`Replicate prediction failed: ${completedPrediction.error}`);
    }

    const output = completedPrediction.output;
    // Gemini 2.5 Flash returns output as array of strings, join them
    const aiResponse = Array.isArray(output) ? output.join('') : String(output);
    console.log(`✅ Chunk ${chunkIndex} AI response received (${aiResponse.length} chars)`);

    // Parse AI response
    let parsedScenes = parseGeminiResponse(aiResponse);
    
    if (parsedScenes.length === 0) {
      console.log(`⚠️  Primary parser failed, trying alternative format for chunk ${chunkIndex}`);
      parsedScenes = parseAlternativeFormat(aiResponse);
    }

    if (parsedScenes.length === 0) {
      console.warn(`⚠️  No scenes found in chunk ${chunkIndex}`);
    }

    console.log(`📊 Parsed ${parsedScenes.length} scenes from chunk ${chunkIndex}`);

    // Adjust timecodes: AI returns timecodes relative to chunk (starting from 00:00:00)
    // We need to add chunk's startTime offset
    const chunkStartSeconds = timecodeToSeconds(startTimecode);
    
    if (chunkStartSeconds > 0) {
      console.log(`⏰ Adjusting timecodes for chunk ${chunkIndex} (offset: ${chunkStartSeconds}s)`);
      
      parsedScenes = parsedScenes.map(scene => {
        const adjustedStartSeconds = timecodeToSeconds(scene.start_timecode) + chunkStartSeconds;
        const adjustedEndSeconds = timecodeToSeconds(scene.end_timecode) + chunkStartSeconds;
        
        return {
          ...scene,
          start_timecode: secondsToTimecode(adjustedStartSeconds),
          end_timecode: secondsToTimecode(adjustedEndSeconds),
        };
      });
      
      console.log(`✅ Adjusted ${parsedScenes.length} scenes' timecodes`);
    }

    // Get sheet ID from chunk progress
    const sheetId = chunkProgress.sheetId;
    if (!sheetId) {
      throw new Error('Sheet ID not found in chunk progress');
    }

    // Calculate base order index for this chunk
    // Each chunk should have entries after the previous chunks
    const baseOrderIndex = chunkIndex * 1000;

    // Insert parsed scenes into database
    const entriesToInsert = parsedScenes.map((scene, index) => ({
      sheet_id: sheetId,
      plan_number: baseOrderIndex + index + 1, // plan_number starts from 1
      order_index: baseOrderIndex + index,
      start_timecode: scene.start_timecode,
      end_timecode: scene.end_timecode,
      plan_type: scene.plan_type || '',
      description: scene.description || '',
      dialogues: scene.dialogues || '',
    }));

    if (entriesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('montage_entries')
        .insert(entriesToInsert);

      if (insertError) {
        console.error(`Error inserting entries for chunk ${chunkIndex}:`, insertError);
        throw new Error(`Failed to insert montage entries for chunk ${chunkIndex}`);
      }
    }

    // Update chunk status to completed
    chunkProgress.chunks[chunkIndex].status = 'completed';
    chunkProgress.completedChunks += 1;
    
    await supabase
      .from('videos')
      .update({ chunk_progress_json: chunkProgress })
      .eq('id', videoId);

    console.log(`✅ Chunk ${chunkIndex} completed: ${parsedScenes.length} scenes saved`);

    return NextResponse.json({
      success: true,
      chunkIndex,
      scenesCount: parsedScenes.length,
      completedChunks: chunkProgress.completedChunks,
      totalChunks: chunkProgress.totalChunks,
    });

  } catch (error) {
    console.error('Error processing chunk:', error);
    
    // Update chunk status to failed using variables from outer scope
    if (videoId && chunkIndex !== undefined) {
      try {
        const supabase = createServiceRoleClient();
        const { data: video } = await supabase
          .from('videos')
          .select('chunk_progress_json')
          .eq('id', videoId)
          .single();
        
        if (video?.chunk_progress_json) {
          const chunkProgress = video.chunk_progress_json;
          if (chunkProgress.chunks[chunkIndex]) {
            chunkProgress.chunks[chunkIndex].status = 'failed';
            await supabase
              .from('videos')
              .update({ chunk_progress_json: chunkProgress })
              .eq('id', videoId);
            console.log(`✅ Updated chunk ${chunkIndex} status to failed`);
          }
        }
      } catch (updateError) {
        console.error('Could not update chunk status to failed:', updateError);
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

