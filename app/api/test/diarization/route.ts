/**
 * TEST: Проверка диаризации от AssemblyAI
 * 
 * Показывает все голоса (Speaker A, B, C...) и их реплики
 * + текущий маппинг на персонажей
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { deserializeDiarization, getWordsInTimeRange, mappingToRecord } from '@/lib/full-audio-diarization';

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get('videoId');
  const startSec = parseFloat(request.nextUrl.searchParams.get('start') || '0');
  const endSec = parseFloat(request.nextUrl.searchParams.get('end') || '180');
  
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }
  
  const supabase = createServiceRoleClient();
  
  // Получаем данные диаризации
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, original_filename, full_diarization')
    .eq('id', videoId)
    .single();
    
  if (error || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }
  
  if (!video.full_diarization) {
    return NextResponse.json({ 
      error: 'No diarization data. Run preprocess-audio first.',
      hint: 'POST /api/preprocess-audio with videoId'
    }, { status: 400 });
  }
  
  const diarizationData = deserializeDiarization(video.full_diarization);
  
  if (!diarizationData) {
    return NextResponse.json({ error: 'Failed to parse diarization data' }, { status: 500 });
  }
  
  // Получаем слова в указанном диапазоне
  const wordsInRange = getWordsInTimeRange(
    diarizationData.result.words,
    startSec * 1000,
    endSec * 1000
  );
  
  // Группируем по спикерам
  const speakerTexts: Record<string, { words: string[]; samples: string[] }> = {};
  
  for (const word of wordsInRange) {
    if (!speakerTexts[word.speaker]) {
      speakerTexts[word.speaker] = { words: [], samples: [] };
    }
    speakerTexts[word.speaker].words.push(word.word);
  }
  
  // Собираем примеры реплик для каждого спикера
  for (const speaker of Object.keys(speakerTexts)) {
    const text = speakerTexts[speaker].words.join(' ');
    // Разбиваем на предложения (примерно)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    speakerTexts[speaker].samples = sentences.slice(0, 3);
  }
  
  // Текущий маппинг
  const mapping = mappingToRecord(diarizationData.speakerMapping || []);
  
  // Формируем результат
  const speakers = Object.entries(speakerTexts).map(([speaker, data]) => ({
    speakerId: speaker,
    characterName: mapping[speaker] || '❓ НЕ ОТКАЛИБРОВАН',
    wordCount: data.words.length,
    samples: data.samples,
    fullText: data.words.join(' ').substring(0, 200) + '...',
  }));
  
  return NextResponse.json({
    videoId,
    filename: video.original_filename,
    timeRange: `${startSec}s - ${endSec}s`,
    
    // Общая статистика
    totalSpeakers: diarizationData.result.speakers.length,
    calibratedSpeakers: diarizationData.speakerMapping?.length || 0,
    totalWords: diarizationData.result.words.length,
    wordsInRange: wordsInRange.length,
    
    // Маппинг спикеров
    speakerMapping: diarizationData.speakerMapping || [],
    
    // Спикеры в диапазоне
    speakers,
    
    // Для отладки
    calibrationDetails: diarizationData.speakerMapping?.map(m => ({
      speaker: m.speakerId,
      character: m.characterName,
      confidence: (m.confidence * 100).toFixed(0) + '%',
      calibratedAt: m.calibrationTimecode,
    })),
  });
}

