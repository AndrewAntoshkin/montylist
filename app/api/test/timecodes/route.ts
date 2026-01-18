/**
 * TEST: Проверка таймкодов от PySceneDetect
 * 
 * Получает видео и возвращает ТОЛЬКО таймкоды сцен
 * для сравнения с реальным монтажным листом
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId');
  
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }
  
  const supabase = createServiceRoleClient();
  
  // Получаем данные о видео
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, original_filename, chunk_progress_json')
    .eq('id', videoId)
    .single();
    
  if (error || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }
  
  const chunkProgress = video.chunk_progress_json as {
    mergedScenes?: Array<{
      start_timecode: string;
      end_timecode: string;
      start_timestamp: number;
      end_timestamp: number;
    }>;
    rawScenesCount?: number;
  } | null;
  
  if (!chunkProgress?.mergedScenes) {
    return NextResponse.json({ 
      error: 'No PySceneDetect data found. Run init-processing-v4 first.' 
    }, { status: 400 });
  }
  
  const scenes = chunkProgress.mergedScenes;
  
  // Форматируем для удобного сравнения
  const timecodes = scenes.map((s, idx) => ({
    plan: idx + 1,
    start: s.start_timecode,
    end: s.end_timecode,
    duration: (s.end_timestamp - s.start_timestamp).toFixed(2) + 's',
  }));
  
  return NextResponse.json({
    videoId,
    filename: video.original_filename,
    totalScenes: scenes.length,
    rawScenesCount: chunkProgress.rawScenesCount,
    timecodes,
    
    // Для быстрого сравнения с real-montage.txt
    firstFive: timecodes.slice(0, 5),
    lastFive: timecodes.slice(-5),
  });
}

