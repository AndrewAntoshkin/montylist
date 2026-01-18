import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Replicate from 'replicate';
import { parseGeminiResponse, parseAlternativeFormat } from '@/lib/parseGeminiResponse';
import { MONTAGE_ANALYSIS_PROMPT, createFullVideoPrompt } from '@/lib/gemini-prompt';
import { mergeScriptWithMontage } from '@/lib/script-video-merger';
import type { ScriptData } from '@/types';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// Increase timeout for video processing (5 minutes)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { videoId, videoUrl, scriptData } = await request.json();

    if (!videoId || !videoUrl) {
      return NextResponse.json(
        { error: 'Missing videoId or videoUrl' },
        { status: 400 }
      );
    }

    // Use Service Role for background processing (no user session)
    const supabase = createServiceRoleClient();

    // Update video status to processing
    await supabase
      .from('videos')
      .update({ status: 'processing' })
      .eq('id', videoId);

    try {
      // Create prompt with script characters if available
      const prompt = scriptData 
        ? createFullVideoPrompt(scriptData as ScriptData)
        : MONTAGE_ANALYSIS_PROMPT;
      
      // Log script data if present
      if (scriptData?.characters?.length > 0) {
        console.log(`📋 Using script with ${scriptData.characters.length} characters`);
        const mainChars = scriptData.characters.filter((c: any) => c.dialogueCount >= 5);
        if (mainChars.length > 0) {
          console.log(`   🌟 Main characters: ${mainChars.map((c: any) => c.name).join(', ')}`);
        }
      }
      
      // Create prediction in async mode (don't wait for result)
      console.log('Creating Replicate prediction for video:', videoId);
      console.log('Video URL:', videoUrl);
      console.log('Prompt length:', prompt.length);
      
      const prediction = await replicate.predictions.create({
        model: 'google/gemini-3-pro',
        input: {
          videos: [videoUrl],
          prompt: prompt,
        },
      });

      console.log('Prediction created:', prediction.id);

      // Poll for completion (with timeout)
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes (5 seconds per attempt)
      let result = prediction;

      while (attempts < maxAttempts) {
        result = await replicate.predictions.get(prediction.id);
        console.log(`Checking prediction status (${attempts + 1}/${maxAttempts}):`, result.status);

        if (result.status === 'succeeded') {
          console.log('Prediction succeeded!');
          break;
        } else if (result.status === 'failed' || result.status === 'canceled') {
          throw new Error(`Prediction ${result.status}: ${result.error || 'Unknown error'}`);
        }

        // Wait 5 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
      }

      if (result.status !== 'succeeded') {
        throw new Error('Prediction timed out after 5 minutes');
      }

      // Output is an array of strings, join them
      const output = result.output;
      const outputText = Array.isArray(output) ? output.join('') : String(output);
      
      console.log('Replicate output received:', outputText.substring(0, 200));

      if (!outputText) {
        throw new Error('No output from Replicate');
      }

      // Parse the response
      let parsedScenes = parseGeminiResponse(outputText);
      
      // Try alternative parser if first one fails
      if (parsedScenes.length === 0) {
        parsedScenes = parseAlternativeFormat(outputText);
      }

      console.log('Parsed scenes count:', parsedScenes.length);
      
      // Debug: log first scene to check parsing
      if (parsedScenes.length > 0) {
        console.log('First scene sample:', JSON.stringify(parsedScenes[0], null, 2));
      }

      if (parsedScenes.length === 0) {
        throw new Error('Failed to parse any scenes from output');
      }
      
      // ═══════════════════════════════════════════════════════════════
      // POST-PROCESSING: Merge with script data to fix generic names
      // ═══════════════════════════════════════════════════════════════
      if (scriptData?.characters?.length > 0) {
        console.log('📋 Merging with script data to fix generic names...');
        
        const mergeResult = mergeScriptWithMontage(
          parsedScenes.map((scene, idx) => ({
            id: String(idx),
            description: scene.description,
            dialogues: scene.dialogues,
          })),
          scriptData as ScriptData
        );
        
        // Apply merged dialogues back to scenes
        for (let i = 0; i < parsedScenes.length && i < mergeResult.entries.length; i++) {
          if (mergeResult.entries[i].dialogues) {
            parsedScenes[i].dialogues = mergeResult.entries[i].dialogues!;
          }
        }
        
        console.log(`✅ Merge complete: ${mergeResult.stats.replacementsMade} replacements made`);
        if (mergeResult.stats.genericNamesFound.length > 0) {
          console.log(`   Generic names found: ${mergeResult.stats.genericNamesFound.join(', ')}`);
        }
      }

      // Get video record to get user_id
      const { data: video } = await supabase
        .from('videos')
        .select('user_id')
        .eq('id', videoId)
        .single();

      if (!video) {
        throw new Error('Video not found');
      }

      // Create montage sheet
      const { data: sheet, error: sheetError } = await supabase
        .from('montage_sheets')
        .insert({
          video_id: videoId,
          user_id: video.user_id,
          title: `Монтажный лист`,
        })
        .select()
        .single();

      if (sheetError) {
        console.error('Error creating sheet:', sheetError);
        throw new Error('Failed to create montage sheet');
      }

      // Insert all entries
      const entries = parsedScenes.map((scene, index) => ({
        sheet_id: sheet.id,
        plan_number: index + 1,
        start_timecode: scene.start_timecode,
        end_timecode: scene.end_timecode,
        plan_type: scene.plan_type,
        description: scene.description,
        dialogues: scene.dialogues,
        order_index: index,
      }));

      const { error: entriesError } = await supabase
        .from('montage_entries')
        .insert(entries);

      if (entriesError) {
        console.error('Error inserting entries:', entriesError);
        throw new Error('Failed to insert montage entries');
      }

      // Update video status to completed
      await supabase
        .from('videos')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', videoId);

      console.log('Video processing completed successfully:', videoId);

      return NextResponse.json({
        success: true,
        sheetId: sheet.id,
        entriesCount: entries.length,
      });
    } catch (processingError: any) {
      console.error('Processing error:', processingError);
      console.error('Error details:', {
        message: processingError.message,
        cause: processingError.cause,
        stack: processingError.stack?.substring(0, 500),
      });

      const errorMessage = processingError.message || 'Processing failed';
      const isFetchError = errorMessage.includes('fetch failed') || errorMessage.includes('timeout');
      const displayError = isFetchError 
        ? 'Video processing timeout - video may be too long or network issue'
        : errorMessage;

      // Update video status to error
      await supabase
        .from('videos')
        .update({
          status: 'error',
          error_message: displayError,
        })
        .eq('id', videoId);

      return NextResponse.json(
        {
          error: 'Processing failed',
          details: displayError,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}


