import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Replicate from 'replicate';
import { parseGeminiResponse, parseAlternativeFormat } from '@/lib/parseGeminiResponse';
import { createChunkPrompt } from '@/lib/gemini-prompt';
import { 
  createVideoChunks, 
  timecodeToSeconds,
  secondsToTimecode,
  deduplicateScenes,
  type VideoChunk 
} from '@/lib/video-chunking';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';
import { 
  downloadVideo, 
  splitVideoIntoChunks, 
  cleanupTempFiles 
} from '@/lib/video-splitter';
import path from 'path';
import fs from 'fs';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// Increase timeout for chunked video processing (10 minutes)
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { videoId, videoUrl, videoDuration } = await request.json();

    if (!videoId || !videoUrl) {
      return NextResponse.json(
        { error: 'Missing videoId or videoUrl' },
        { status: 400 }
      );
    }

    if (!videoDuration) {
      return NextResponse.json(
        { error: 'Missing videoDuration for chunked processing' },
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
      // Create chunks based on video duration
      const chunks = createVideoChunks(videoDuration);
      
      console.log(`🎬 Processing video ${videoId} in ${chunks.length} chunk(s):`, chunks);

      // Get existing video data to check if chunk_progress already exists
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('chunk_progress_json')
        .eq('id', videoId)
        .single();

      // Use existing chunk_progress or create new one
      const chunkProgress = existingVideo?.chunk_progress_json || {
        totalChunks: chunks.length,
        completedChunks: 0,
        currentChunk: 0,
        chunks: chunks.map(chunk => ({
          index: chunk.chunkIndex,
          status: 'pending' as const,
          startTimecode: chunk.startTimecode,
          endTimecode: chunk.endTimecode,
        })),
      };

      // Save initial progress only if it didn't exist
      if (!existingVideo?.chunk_progress_json) {
        await supabase
          .from('videos')
          .update({ chunk_progress_json: chunkProgress })
          .eq('id', videoId);
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
          title: `Монтажный лист (${chunks.length} частей)`,
        })
        .select()
        .single();

      if (sheetError) {
        console.error('Error creating sheet:', sheetError);
        throw new Error('Failed to create montage sheet');
      }

      // Download original video to temp location
      const tempDir = '/tmp/video-chunks';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const originalVideoPath = path.join(tempDir, `original_${videoId}.mp4`);
      console.log(`📥 Downloading original video...`);
      await downloadVideo(videoUrl, originalVideoPath);
      
      // Split video into chunks
      console.log(`✂️  Splitting video into ${chunks.length} chunks...`);
      const chunkFiles = await splitVideoIntoChunks(
        originalVideoPath,
        chunks.map(c => ({
          chunkIndex: c.chunkIndex,
          startTime: c.startTime,
          endTime: c.endTime,
        })),
        tempDir
      );
      
      // Track all temp files for cleanup
      const tempFiles = [originalVideoPath, ...chunkFiles.map(c => c.localPath)];
      
      // Process each chunk
      let allParsedScenes: any[] = [];
      const chunkErrors: string[] = [];
      
      for (const chunk of chunks) {
        console.log(`📹 Processing chunk ${chunk.chunkIndex + 1}/${chunks.length}: ${chunk.startTimecode} - ${chunk.endTimecode}`);
        
        try {
        // Update chunk status to processing
        chunkProgress.currentChunk = chunk.chunkIndex;
        chunkProgress.chunks[chunk.chunkIndex].status = 'processing';
        await supabase
          .from('videos')
          .update({ chunk_progress_json: chunkProgress })
          .eq('id', videoId);
        
        // Get chunk file
        const chunkFile = chunkFiles.find(cf => cf.chunkIndex === chunk.chunkIndex);
        if (!chunkFile) {
          throw new Error(`Chunk file not found for index ${chunk.chunkIndex}`);
        }
        
        // Upload chunk to Supabase Storage
        const chunkStoragePath = `${video.user_id}/chunks/chunk_${chunk.chunkIndex}_${Date.now()}.mp4`;
        console.log(`☁️  Uploading chunk ${chunk.chunkIndex + 1} to storage...`);
        
        const chunkBuffer = fs.readFileSync(chunkFile.localPath);
        const { error: uploadError } = await supabase.storage
          .from('videos')
          .upload(chunkStoragePath, chunkBuffer, {
            contentType: 'video/mp4',
            upsert: false,
          });
        
        if (uploadError) {
          console.error('Error uploading chunk:', uploadError);
          throw new Error(`Failed to upload chunk ${chunk.chunkIndex + 1}`);
        }
        
        // Get signed URL for chunk
        const { data: chunkUrlData, error: chunkUrlError } = await supabase.storage
          .from('videos')
          .createSignedUrl(chunkStoragePath, 7200); // 2 hours
        
        if (chunkUrlError || !chunkUrlData?.signedUrl) {
          throw new Error(`Failed to create signed URL for chunk ${chunk.chunkIndex + 1}`);
        }
        
        const chunkVideoUrl = chunkUrlData.signedUrl;
        
        // Debug info
        const chunkFileStats = fs.statSync(chunkFile.localPath);
        console.log(`✅ Chunk ${chunk.chunkIndex + 1} info:`);
        console.log(`   - Local file size: ${(chunkFileStats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   - Duration: ${chunkFile.duration}s`);
        console.log(`   - Storage path: ${chunkStoragePath}`);
        
        // Test if URL is accessible
        console.log(`🔗 Testing chunk URL accessibility...`);
        try {
          const testResponse = await fetch(chunkVideoUrl, { method: 'HEAD' });
          console.log(`   - URL status: ${testResponse.status} ${testResponse.statusText}`);
          console.log(`   - Content-Type: ${testResponse.headers.get('content-type')}`);
          console.log(`   - Content-Length: ${testResponse.headers.get('content-length')}`);
        } catch (urlError) {
          console.error(`   ❌ URL test failed:`, urlError);
        }
        
        // Track chunk storage path for cleanup
        tempFiles.push(chunkStoragePath);
        
        // Create chunk-specific prompt
        const chunkPrompt = createChunkPrompt(
          chunk.chunkIndex,
          chunk.startTimecode,
          chunk.endTimecode,
          chunks.length
        );

        console.log('Chunk prompt length:', chunkPrompt.length);

        // Create prediction for this chunk with retry
        // NOW USING CHUNK VIDEO URL instead of full video!
        const prediction = await createPredictionWithRetry(
          replicate,
          'google/gemini-2.5-flash',
          {
            videos: [chunkVideoUrl], // ← Using chunk video!
            prompt: chunkPrompt,
          },
          3 // max 3 retries
        );

        console.log(`Prediction created for chunk ${chunk.chunkIndex + 1}:`, prediction.id);

        // Poll for completion with better error handling
        const result = await pollPrediction(
          replicate,
          prediction.id,
          60, // max 60 attempts (5 minutes)
          5000 // poll every 5 seconds
        );

        console.log(`✅ Chunk ${chunk.chunkIndex + 1} succeeded!`);

        // Parse chunk output
        const output = result.output;
        const outputText = Array.isArray(output) ? output.join('') : String(output);
        
        console.log(`Chunk ${chunk.chunkIndex + 1} output length:`, outputText.length);
        
        // DEBUG: Показываем первые 1000 символов ответа
        if (outputText.length === 0) {
          console.error(`❌ Chunk ${chunk.chunkIndex + 1} returned EMPTY output!`);
          console.log('Full output object:', JSON.stringify(output, null, 2));
        } else {
          console.log(`Chunk ${chunk.chunkIndex + 1} output preview (first 1000 chars):`, outputText.substring(0, 1000));
        }

        let parsedScenes = parseGeminiResponse(outputText);
        
        if (parsedScenes.length === 0) {
          console.log(`⚠️ Primary parser returned 0 scenes, trying alternative format...`);
          parsedScenes = parseAlternativeFormat(outputText);
        }

        console.log(`Chunk ${chunk.chunkIndex + 1} parsed scenes count:`, parsedScenes.length);
        
        // DEBUG: Если все еще 0 сцен - выведем весь ответ для анализа
        if (parsedScenes.length === 0 && outputText.length > 0) {
          console.error(`❌ Both parsers failed! Output text:`, outputText.substring(0, 2000));
        }
        
        if (parsedScenes.length > 0) {
          console.log(`First scene from chunk ${chunk.chunkIndex + 1} (before timecode adjustment):`, parsedScenes[0]);
        }

        // Adjust timecodes for chunks after the first one
        // Model outputs timecodes starting from 00:00:00, we need to add chunk's startTime offset
        if (chunk.chunkIndex > 0) {
          parsedScenes = parsedScenes.map(scene => {
            const startSeconds = timecodeToSeconds(scene.start_timecode) + chunk.startTime;
            const endSeconds = timecodeToSeconds(scene.end_timecode) + chunk.startTime;
            
            return {
              ...scene,
              start_timecode: secondsToTimecode(startSeconds),
              end_timecode: secondsToTimecode(endSeconds),
              timecode: `${secondsToTimecode(startSeconds)} - ${secondsToTimecode(endSeconds)}`,
            };
          });
          
          console.log(`Chunk ${chunk.chunkIndex + 1} - After timecode adjustment:`, parsedScenes[0]);
        }

        // Filter out scenes from overlap region (except for last chunk)
        // Overlap region is last 15 seconds of each chunk
        if (chunk.chunkIndex < chunks.length - 1) {
          const overlapStartTime = chunk.endTime - 15; // 15 seconds overlap (absolute time)
          const beforeFilterCount = parsedScenes.length;
          
          parsedScenes = parsedScenes.filter(scene => {
            // After timecode adjustment, timecodes are in absolute time
            const sceneStartSeconds = timecodeToSeconds(scene.start_timecode);
            // Keep only scenes that start before overlap region
            return sceneStartSeconds < overlapStartTime;
          });
          
          console.log(`Chunk ${chunk.chunkIndex + 1} - After overlap filtering: ${parsedScenes.length} scenes (removed ${beforeFilterCount - parsedScenes.length})`);
        }

        allParsedScenes = allParsedScenes.concat(parsedScenes);
        console.log(`📊 Total scenes so far: ${allParsedScenes.length}`);
        
        // Update chunk status to completed
        chunkProgress.chunks[chunk.chunkIndex].status = 'completed';
        chunkProgress.completedChunks++;
        await supabase
          .from('videos')
          .update({ chunk_progress_json: chunkProgress })
          .eq('id', videoId);
        
        } catch (chunkError: any) {
          const errorMsg = `Chunk ${chunk.chunkIndex + 1} failed: ${chunkError.message}`;
          console.error(`❌ ${errorMsg}`);
          chunkErrors.push(errorMsg);
          
          // Update chunk status to failed
          chunkProgress.chunks[chunk.chunkIndex].status = 'failed';
          await supabase
            .from('videos')
            .update({ chunk_progress_json: chunkProgress })
            .eq('id', videoId);
          
          // Продолжаем обработку следующих чанков
          // Можно решить: прервать или продолжить
          // Сейчас прерываем, но можно изменить логику
          throw new Error(errorMsg);
        }
      }

      console.log('🎉 All chunks processed! Total scenes:', allParsedScenes.length);
      
      if (chunkErrors.length > 0) {
        console.warn('⚠️ Some chunks had errors:', chunkErrors);
      }

      if (allParsedScenes.length === 0) {
        throw new Error('Failed to parse any scenes from all chunks');
      }

      // Remove duplicate scenes in overlap zones
      const dedupedScenes = deduplicateScenes(allParsedScenes);
      console.log('After deduplication:', dedupedScenes.length, 'scenes');

      // Insert all entries
      const entries = dedupedScenes.map((scene, index) => ({
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

      console.log('✅ Video processing completed successfully:', videoId);

      // Cleanup temp files
      console.log('🧹 Cleaning up temporary files...');
      await cleanupTempFiles(tempFiles.filter(f => !f.includes('/chunks/'))); // Keep only local files, not storage paths
      
      // Also delete chunks from storage
      const chunkStoragePaths = tempFiles.filter(f => f.includes('/chunks/'));
      if (chunkStoragePaths.length > 0) {
        console.log(`🗑️  Deleting ${chunkStoragePaths.length} chunks from storage...`);
        await supabase.storage.from('videos').remove(chunkStoragePaths);
      }

      return NextResponse.json({
        success: true,
        sheetId: sheet.id,
        entriesCount: entries.length,
        chunksProcessed: chunks.length,
      });
    } catch (processingError: any) {
      console.error('❌ Processing error:', processingError);
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

      // Cleanup temp files even on error
      try {
        if (typeof tempFiles !== 'undefined' && tempFiles.length > 0) {
          console.log('🧹 Cleaning up temporary files after error...');
          const localFiles = tempFiles.filter(f => !f.includes('/chunks/'));
          if (localFiles.length > 0) {
            await cleanupTempFiles(localFiles);
          }
          
          const chunkStoragePaths = tempFiles.filter(f => f.includes('/chunks/'));
          if (chunkStoragePaths.length > 0) {
            console.log(`🗑️  Deleting ${chunkStoragePaths.length} chunks from storage after error...`);
            const { error: removeError } = await supabase.storage.from('videos').remove(chunkStoragePaths);
            if (removeError) {
              console.error('Error removing chunks from storage:', removeError);
            } else {
              console.log('✅ Chunks cleaned from storage');
            }
          }
        }
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }

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

