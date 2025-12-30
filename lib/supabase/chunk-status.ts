import { createServiceRoleClient } from './server';

/**
 * Атомарное обновление статуса чанка
 * Решает проблему race condition при параллельной обработке
 * 
 * Вместо read-modify-write делаем UPDATE с jsonb_set
 */
export async function updateChunkStatus(
  videoId: string,
  chunkIndex: number,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  error?: string
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  
  try {
    // Используем raw SQL через RPC для атомарного обновления
    // Это решает race condition при параллельных обновлениях
    const { error: rpcError } = await supabase.rpc('update_chunk_status', {
      p_video_id: videoId,
      p_chunk_index: chunkIndex,
      p_status: status,
      p_error: error || null
    });

    if (rpcError) {
      console.error(`Failed to update chunk ${chunkIndex} status via RPC:`, rpcError);
      // Fallback to regular update (may have race condition)
      return await fallbackUpdateChunkStatus(videoId, chunkIndex, status, error);
    }

    console.log(`✅ Atomically updated chunk ${chunkIndex} status to ${status}`);
    return true;
  } catch (err) {
    console.error(`Error in updateChunkStatus:`, err);
    return await fallbackUpdateChunkStatus(videoId, chunkIndex, status, error);
  }
}

/**
 * Fallback: обычное обновление (может иметь race condition)
 * Используется если RPC функция не существует
 */
async function fallbackUpdateChunkStatus(
  videoId: string,
  chunkIndex: number,
  status: string,
  error?: string
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  
  // Читаем текущее состояние
  const { data: video, error: fetchError } = await supabase
    .from('videos')
    .select('chunk_progress_json')
    .eq('id', videoId)
    .single();

  if (fetchError || !video?.chunk_progress_json) {
    console.error('Failed to fetch video for fallback update:', fetchError);
    return false;
  }

  const chunkProgress = video.chunk_progress_json;
  
  if (!chunkProgress.chunks[chunkIndex]) {
    console.error(`Chunk ${chunkIndex} not found in progress`);
    return false;
  }

  // Обновляем только нужный чанк
  chunkProgress.chunks[chunkIndex].status = status;
  if (error) {
    chunkProgress.chunks[chunkIndex].error = error;
  }
  
  // Пересчитываем completedChunks
  chunkProgress.completedChunks = chunkProgress.chunks.filter(
    (c: any) => c.status === 'completed'
  ).length;

  const { error: updateError } = await supabase
    .from('videos')
    .update({ chunk_progress_json: chunkProgress })
    .eq('id', videoId);

  if (updateError) {
    console.error('Fallback update failed:', updateError);
    return false;
  }

  console.log(`✅ Fallback: Updated chunk ${chunkIndex} status to ${status}`);
  return true;
}

/**
 * Получить количество реально завершённых чанков
 * Считает по записям в montage_entries (source of truth)
 */
export async function getActualCompletedChunks(sheetId: string): Promise<{
  completedChunks: number;
  chunkIndices: number[];
}> {
  const supabase = createServiceRoleClient();
  
  const { data: entries, error } = await supabase
    .from('montage_entries')
    .select('chunk_index')
    .eq('sheet_id', sheetId);

  if (error || !entries) {
    return { completedChunks: 0, chunkIndices: [] };
  }

  const chunkSet = new Set(entries.map(e => e.chunk_index));
  const uniqueChunks = Array.from(chunkSet).filter(
    i => i !== null && i !== undefined
  );

  return {
    completedChunks: uniqueChunks.length,
    chunkIndices: uniqueChunks.sort((a, b) => a - b)
  };
}



