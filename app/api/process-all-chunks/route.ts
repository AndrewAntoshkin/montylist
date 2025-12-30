import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Agent } from 'undici';
import { 
  createEmptyRegistry, 
  extractAndAddToRegistry, 
  formatRegistryForPrompt,
  type CharacterRegistry 
} from '@/lib/character-registry';

const longRequestAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

// Very short timeout - this endpoint just triggers background processing
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Triggers processing of all chunks sequentially
 * This endpoint returns immediately and processing continues in background
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }

    console.log(`🚀 Triggering background processing for all chunks of video ${videoId}`);

    // Get the base URL for internal API calls
    // Try to get from request headers first, then env, then fallback
    const host = request.headers.get('host') || 'localhost:3001';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;
    
    console.log(`🌐 Using base URL for chunk processing: ${baseUrl}`);

    // Start background processing (fire and forget)
    processAllChunksInBackground(videoId, baseUrl).catch(err => {
      console.error(`❌ Background processing failed for video ${videoId}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: 'Background processing started',
      videoId,
    });

  } catch (error) {
    console.error('Error triggering chunk processing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * ПОСЛЕДОВАТЕЛЬНАЯ обработка чанков с накопительным реестром персонажей
 * 
 * Каждый чанк обрабатывается по очереди:
 * 1. Получаем текущий реестр имён
 * 2. Отправляем в AI вместе с реестром
 * 3. Извлекаем новые имена из ответа → добавляем в реестр
 * 4. Переходим к следующему чанку
 */
async function processAllChunksInBackground(videoId: string, baseUrl: string) {
  try {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📦 SEQUENTIAL PROCESSING for video ${videoId}`);
    console.log(`${'═'.repeat(70)}`);

    const supabase = createServiceRoleClient();

    // Fetch video data
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error(`Failed to fetch video data: ${videoError?.message}`);
    }

    let chunkProgress = video.chunk_progress_json;

    if (!chunkProgress || !chunkProgress.chunks) {
      throw new Error('No chunk progress found');
    }

    const chunks = chunkProgress.chunks;
    console.log(`📊 Found ${chunks.length} chunks to process SEQUENTIALLY`);

    // Get or create sheet
    const { data: sheetData } = await supabase
      .from('montage_sheets')
      .select('id')
      .eq('video_id', videoId)
      .single();

    // ════════════════════════════════════════════════════════════════
    // ИНИЦИАЛИЗАЦИЯ РЕЕСТРА ПЕРСОНАЖЕЙ
    // ════════════════════════════════════════════════════════════════
    
    let registry: CharacterRegistry = chunkProgress.characterRegistry || createEmptyRegistry();
    console.log(`🎭 Starting with ${registry.characters.length} known characters`);

    // ════════════════════════════════════════════════════════════════
    // ПОСЛЕДОВАТЕЛЬНАЯ ОБРАБОТКА ВСЕХ ЧАНКОВ
    // ════════════════════════════════════════════════════════════════

    let successCount = 0;
    let failCount = 0;
    const failedChunks: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📦 CHUNK ${i + 1}/${chunks.length} (index: ${chunk.index})`);
      console.log(`   Timecode: ${chunk.startTimecode} → ${chunk.endTimecode}`);
      console.log(`   Known characters: ${registry.characters.length}`);
      console.log(`${'─'.repeat(50)}`);
      
      // Пропускаем уже обработанные
      if (chunk.status === 'completed') {
        console.log(`   ✅ Already completed, extracting characters...`);
        
        // Всё равно извлекаем персонажей из существующих записей
        if (sheetData) {
          const { data: chunkEntries } = await supabase
            .from('montage_entries')
            .select('description, dialogues')
            .eq('sheet_id', sheetData.id)
            .gte('start_timecode', chunk.startTimecode)
            .lte('end_timecode', chunk.endTimecode);
          
          if (chunkEntries) {
            const { added } = extractAndAddToRegistry(registry, chunkEntries, i);
            if (added.length > 0) {
              console.log(`   🎭 Added ${added.length} characters: ${added.join(', ')}`);
            }
          }
        }
        
        successCount++;
        continue;
      }
      
      if (chunk.status === 'processing') {
        console.log(`   ⚠️ Already processing, skipping...`);
        continue;
      }
      
      if (!chunk.storageUrl) {
        console.log(`   ❌ No storage URL, skipping...`);
        failCount++;
        continue;
      }

      // ═══════════════════════════════════════════════════════
      // ОБРАБОТКА ЧАНКА С ПЕРЕДАЧЕЙ РЕЕСТРА
      // ═══════════════════════════════════════════════════════
      
      try {
        // Сохраняем реестр в chunk_progress перед обработкой
        const { data: currentVideo } = await supabase
          .from('videos')
          .select('chunk_progress_json')
          .eq('id', videoId)
          .single();
        
        if (currentVideo) {
          const updatedProgress = currentVideo.chunk_progress_json;
          updatedProgress.characterRegistry = registry;
          
          await supabase
            .from('videos')
            .update({ chunk_progress_json: updatedProgress })
            .eq('id', videoId);
        }

        console.log(`   🚀 Sending to AI with ${registry.characters.length} known characters...`);
        
        const chunkResponse = await fetch(`${baseUrl}/api/process-chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: chunk.index,
            chunkStorageUrl: chunk.storageUrl,
            startTimecode: chunk.startTimecode,
            endTimecode: chunk.endTimecode,
          }),
          dispatcher: longRequestAgent,
        } as any);

        if (!chunkResponse.ok) {
          const error = await chunkResponse.json();
          throw new Error(`AI request failed: ${error.error}`);
        }

        const chunkData = await chunkResponse.json();
        console.log(`   ✅ Processed: ${chunkData.scenesCount} scenes`);

        // ═══════════════════════════════════════════════════════
        // ИЗВЛЕЧЕНИЕ НОВЫХ ПЕРСОНАЖЕЙ ИЗ ОТВЕТА
        // ═══════════════════════════════════════════════════════
        
        if (sheetData) {
          // Получаем только что добавленные записи
          const { data: newEntries } = await supabase
            .from('montage_entries')
            .select('description, dialogues')
            .eq('sheet_id', sheetData.id)
            .gte('start_timecode', chunk.startTimecode)
            .lte('end_timecode', chunk.endTimecode);
          
          if (newEntries && newEntries.length > 0) {
            const { added, existing } = extractAndAddToRegistry(registry, newEntries, i);
            
            if (added.length > 0) {
              console.log(`   🎭 NEW characters found: ${added.join(', ')}`);
            }
            
            // Валидация: проверяем использование generic имён
            const genericCount = newEntries.filter(e => 
              (e.dialogues || '').includes('МУЖЧИНА') || 
              (e.dialogues || '').includes('ЖЕНЩИНА')
            ).length;
            
            if (genericCount > 0 && registry.characters.length > 0) {
              console.log(`   ⚠️ Warning: ${genericCount} entries still use generic names`);
            }
          }
        }
        
        successCount++;
        
        // Небольшая пауза между чанками
        if (i < chunks.length - 1) {
          console.log(`   ⏳ Waiting 1s before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
        failCount++;
        failedChunks.push(chunk);
        
        // Продолжаем со следующим чанком
        continue;
      }
    }

    // ════════════════════════════════════════════════════════════════
    // RETRY FAILED CHUNKS (один раз)
    // ════════════════════════════════════════════════════════════════
    
    if (failedChunks.length > 0 && failedChunks.length <= 5) {
      console.log(`\n🔄 RETRY: ${failedChunks.length} failed chunks...`);
      
      for (const chunk of failedChunks) {
        try {
          console.log(`   🔄 Retrying chunk ${chunk.index}...`);
          
          const chunkResponse = await fetch(`${baseUrl}/api/process-chunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId,
              chunkIndex: chunk.index,
              chunkStorageUrl: chunk.storageUrl,
              startTimecode: chunk.startTimecode,
              endTimecode: chunk.endTimecode,
            }),
            dispatcher: longRequestAgent,
          } as any);

          if (chunkResponse.ok) {
            const chunkData = await chunkResponse.json();
            console.log(`   ✅ Retry OK: ${chunkData.scenesCount} scenes`);
            successCount++;
            failCount--;
          }
        } catch (error) {
          console.error(`   ❌ Retry failed:`, error);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ФИНАЛЬНОЕ СОХРАНЕНИЕ РЕЕСТРА
    // ════════════════════════════════════════════════════════════════
    
    const { data: finalVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    if (finalVideo) {
      const finalProgress = finalVideo.chunk_progress_json;
      finalProgress.characterRegistry = registry;
      
      await supabase
        .from('videos')
        .update({ chunk_progress_json: finalProgress })
        .eq('id', videoId);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📊 SEQUENTIAL PROCESSING COMPLETE`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   🎭 Total characters: ${registry.characters.length}`);
    if (registry.characters.length > 0) {
      console.log(`   Names: ${registry.characters.map(c => c.name).join(', ')}`);
    }
    console.log(`${'═'.repeat(70)}`);

    // ════════════════════════════════════════════════════════════════
    // FINALIZE
    // ════════════════════════════════════════════════════════════════
    
    console.log(`\n🎉 Starting finalization...`);

    const finalizeResponse = await fetch(`${baseUrl}/api/finalize-processing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json();
      throw new Error(`Failed to finalize: ${error.error}`);
    }

    const finalizeData = await finalizeResponse.json();
    console.log(`🎊 Video ${videoId} DONE! Total entries: ${finalizeData.totalEntries}`);

  } catch (error) {
    console.error(`❌ Background processing error for video ${videoId}:`, error);
    throw error;
  }
}

