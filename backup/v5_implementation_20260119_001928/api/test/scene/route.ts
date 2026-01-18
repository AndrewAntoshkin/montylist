/**
 * TEST: Детальный просмотр одной сцены
 * 
 * Показывает ВСЕ данные для конкретной сцены:
 * - Таймкод (PySceneDetect)
 * - Описание (Gemini)
 * - Реплики (AssemblyAI)
 * - Спикеры и их маппинг
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { deserializeDiarization, getWordsInTimeRange, mappingToRecord } from '@/lib/full-audio-diarization';
import { timecodeToSeconds } from '@/lib/video-chunking';

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId');
  const sceneNumber = parseInt(request.nextUrl.searchParams.get('scene') || '1');
  
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }
  
  const supabase = createServiceRoleClient();
  
  // Получаем все данные
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, original_filename, chunk_progress_json, full_diarization')
    .eq('id', videoId)
    .single();
    
  if (error || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }
  
  // Получаем таймкоды сцен
  const chunkProgress = video.chunk_progress_json as {
    mergedScenes?: Array<{
      start_timecode: string;
      end_timecode: string;
      start_timestamp: number;
      end_timestamp: number;
    }>;
  } | null;
  
  if (!chunkProgress?.mergedScenes) {
    return NextResponse.json({ error: 'No scene data' }, { status: 400 });
  }
  
  const sceneIndex = sceneNumber - 1;
  if (sceneIndex < 0 || sceneIndex >= chunkProgress.mergedScenes.length) {
    return NextResponse.json({ 
      error: `Scene ${sceneNumber} not found. Total scenes: ${chunkProgress.mergedScenes.length}` 
    }, { status: 400 });
  }
  
  const scene = chunkProgress.mergedScenes[sceneIndex];
  const startMs = scene.start_timestamp * 1000;
  const endMs = scene.end_timestamp * 1000;
  
  // Получаем сгенерированные данные для этой сцены
  const { data: sheets } = await supabase
    .from('montage_sheets')
    .select('id')
    .eq('video_id', videoId)
    .limit(1);
    
  let generatedEntry = null;
  if (sheets?.[0]) {
    const { data: entries } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheets[0].id)
      .eq('plan_number', sceneNumber)
      .limit(1);
    generatedEntry = entries?.[0];
  }
  
  // Получаем ASR данные для этой сцены
  let asrData = null;
  if (video.full_diarization) {
    const diarizationData = deserializeDiarization(video.full_diarization);
    if (diarizationData) {
      const wordsInScene = getWordsInTimeRange(diarizationData.result.words, startMs, endMs);
      const mapping = mappingToRecord(diarizationData.speakerMapping || []);
      
      // Группируем слова по спикерам
      const speakerSegments: Array<{ speaker: string; character: string; text: string }> = [];
      let currentSpeaker = '';
      let currentWords: string[] = [];
      
      for (const word of wordsInScene) {
        if (word.speaker !== currentSpeaker) {
          if (currentWords.length > 0) {
            speakerSegments.push({
              speaker: currentSpeaker,
              character: mapping[currentSpeaker] || '❓',
              text: currentWords.join(' '),
            });
          }
          currentSpeaker = word.speaker;
          currentWords = [word.word];
        } else {
          currentWords.push(word.word);
        }
      }
      if (currentWords.length > 0) {
        speakerSegments.push({
          speaker: currentSpeaker,
          character: mapping[currentSpeaker] || '❓',
          text: currentWords.join(' '),
        });
      }
      
      asrData = {
        totalWords: wordsInScene.length,
        speakers: [...new Set(wordsInScene.map(w => w.speaker))],
        segments: speakerSegments,
        rawText: wordsInScene.map(w => w.word).join(' '),
      };
    }
  }
  
  return NextResponse.json({
    sceneNumber,
    timecode: {
      start: scene.start_timecode,
      end: scene.end_timecode,
      duration: (scene.end_timestamp - scene.start_timestamp).toFixed(2) + 's',
    },
    
    // Сгенерированные данные (если есть)
    generated: generatedEntry ? {
      planType: generatedEntry.plan_type,
      description: generatedEntry.description,
      dialogues: generatedEntry.dialogues,
    } : null,
    
    // ASR данные
    asr: asrData,
    
    // Для сравнения
    comparison: {
      generatedDialogue: generatedEntry?.dialogues || '(нет)',
      asrDialogue: asrData?.rawText || '(нет ASR)',
      match: asrData?.rawText && generatedEntry?.dialogues 
        ? generatedEntry.dialogues.toLowerCase().includes(asrData.rawText.toLowerCase().substring(0, 20))
        : null,
    },
    
    // Навигация
    navigation: {
      prev: sceneNumber > 1 ? sceneNumber - 1 : null,
      next: sceneNumber < chunkProgress.mergedScenes.length ? sceneNumber + 1 : null,
      total: chunkProgress.mergedScenes.length,
    },
  });
}

