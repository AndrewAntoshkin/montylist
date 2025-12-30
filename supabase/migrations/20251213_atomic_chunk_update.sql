-- Функция для атомарного обновления статуса чанка
-- Решает проблему race condition при параллельной обработке

CREATE OR REPLACE FUNCTION update_chunk_status(
  p_video_id UUID,
  p_chunk_index INTEGER,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_chunks JSONB;
  v_chunk JSONB;
  v_completed_count INTEGER;
BEGIN
  -- Получаем текущий chunk_progress_json с блокировкой строки
  SELECT chunk_progress_json INTO v_chunks
  FROM videos
  WHERE id = p_video_id
  FOR UPDATE;

  IF v_chunks IS NULL THEN
    RAISE EXCEPTION 'Video not found or no chunk progress';
  END IF;

  -- Получаем текущий чанк
  v_chunk := v_chunks->'chunks'->p_chunk_index;
  
  IF v_chunk IS NULL THEN
    RAISE EXCEPTION 'Chunk % not found', p_chunk_index;
  END IF;

  -- Обновляем статус чанка
  v_chunk := jsonb_set(v_chunk, '{status}', to_jsonb(p_status));
  
  -- Добавляем ошибку если есть
  IF p_error IS NOT NULL THEN
    v_chunk := jsonb_set(v_chunk, '{error}', to_jsonb(p_error));
  ELSE
    v_chunk := v_chunk - 'error'; -- Удаляем ошибку если статус успешный
  END IF;

  -- Обновляем чанк в массиве
  v_chunks := jsonb_set(v_chunks, ARRAY['chunks', p_chunk_index::text], v_chunk);

  -- Пересчитываем количество завершённых чанков
  SELECT COUNT(*) INTO v_completed_count
  FROM jsonb_array_elements(v_chunks->'chunks') AS chunk
  WHERE chunk->>'status' = 'completed';

  v_chunks := jsonb_set(v_chunks, '{completedChunks}', to_jsonb(v_completed_count));

  -- Атомарно обновляем запись
  UPDATE videos
  SET chunk_progress_json = v_chunks,
      updated_at = NOW()
  WHERE id = p_video_id;

END;
$$ LANGUAGE plpgsql;

-- Даём права на выполнение
GRANT EXECUTE ON FUNCTION update_chunk_status TO service_role;
GRANT EXECUTE ON FUNCTION update_chunk_status TO authenticated;

COMMENT ON FUNCTION update_chunk_status IS 
'Атомарное обновление статуса чанка видео. 
Использует FOR UPDATE для предотвращения race condition при параллельной обработке.';



