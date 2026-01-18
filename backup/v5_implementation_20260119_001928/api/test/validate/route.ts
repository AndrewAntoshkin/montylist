/**
 * TEST: Валидатор — Gemini собирает финальный результат
 * 
 * Получает:
 * - Таймкоды от PySceneDetect
 * - Реплики от AssemblyAI
 * - Описания от Gemini (визуал)
 * - Персонажей из сценария
 * 
 * Собирает: правильный монтажный лист
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { deserializeDiarization, getWordsInTimeRange, mappingToRecord } from '@/lib/full-audio-diarization';
import { timecodeToSeconds } from '@/lib/video-chunking';
import Replicate from 'replicate';

const VALIDATOR_PROMPT = `Ты — редактор монтажных листов. Твоя задача: собрать данные из разных источников в ОДИН правильный результат.

ВХОДНЫЕ ДАННЫЕ:
{scenes_data}

ПЕРСОНАЖИ ФИЛЬМА:
{characters}

ЗАДАЧА:
Для каждой сцены определи:
1. КТО говорит — используй ASR спикеров + описание + персонажей
2. ЧТО говорит — используй текст от ASR (он точнее!)
3. Проверь соответствие — описание должно совпадать с говорящим

ФОРМАТ ОТВЕТА (JSON):
[
  {
    "scene": 1,
    "timecode": "00:00:00:00 - 00:00:04:09",
    "description": "Описание сцены",
    "speaker": "ГАЛИНА",
    "dialogue": "Текст реплики",
    "confidence": "high/medium/low",
    "notes": "Почему так решил"
  }
]

ПРАВИЛА:
- Если ASR показывает Speaker A с текстом "Тань, скажи..." и описание "Галя спрашивает Таню" → Speaker A = ГАЛИНА
- Если нет речи (только музыка) → speaker: null, dialogue: "Музыка"
- Используй КОРОТКИЕ имена (ГАЛЯ, ТАНЯ, не ГАЛИНА, ТАТЬЯНА) если они есть в персонажах

ВАЖНО: ASR текст = ИСТИНА. Не меняй его!
`;

export async function POST(request: NextRequest) {
  const { videoId, sceneStart = 1, sceneEnd = 10 } = await request.json();
  
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
  
  const chunkProgress = video.chunk_progress_json as {
    mergedScenes?: Array<{
      start_timecode: string;
      end_timecode: string;
      start_timestamp: number;
      end_timestamp: number;
    }>;
    scriptData?: {
      characters?: Array<{
        name: string;
        description?: string;
        shortName?: string;
      }>;
    };
  } | null;
  
  if (!chunkProgress?.mergedScenes) {
    return NextResponse.json({ error: 'No scene data' }, { status: 400 });
  }
  
  // Получаем диаризацию
  const diarizationData = video.full_diarization 
    ? deserializeDiarization(video.full_diarization)
    : null;
  const mapping = diarizationData 
    ? mappingToRecord(diarizationData.speakerMapping || [])
    : {};
  
  // Получаем сгенерированные описания
  const { data: sheets } = await supabase
    .from('montage_sheets')
    .select('id')
    .eq('video_id', videoId)
    .limit(1);
    
  let generatedEntries: Record<number, { description: string; dialogues: string }> = {};
  if (sheets?.[0]) {
    const { data: entries } = await supabase
      .from('montage_entries')
      .select('plan_number, description, dialogues')
      .eq('sheet_id', sheets[0].id)
      .gte('plan_number', sceneStart)
      .lte('plan_number', sceneEnd);
      
    if (entries) {
      for (const e of entries) {
        generatedEntries[e.plan_number] = {
          description: e.description,
          dialogues: e.dialogues,
        };
      }
    }
  }
  
  // Собираем данные для выбранных сцен
  const scenesData: string[] = [];
  
  for (let i = sceneStart - 1; i < Math.min(sceneEnd, chunkProgress.mergedScenes.length); i++) {
    const scene = chunkProgress.mergedScenes[i];
    const sceneNum = i + 1;
    const startMs = scene.start_timestamp * 1000;
    const endMs = scene.end_timestamp * 1000;
    
    // ASR для этой сцены
    let asrInfo = 'Нет ASR данных';
    if (diarizationData) {
      const wordsInScene = getWordsInTimeRange(diarizationData.result.words, startMs, endMs);
      if (wordsInScene.length > 0) {
        // Группируем по спикерам
        const segments: string[] = [];
        let currentSpeaker = '';
        let currentWords: string[] = [];
        
        for (const word of wordsInScene) {
          if (word.speaker !== currentSpeaker) {
            if (currentWords.length > 0) {
              const charName = mapping[currentSpeaker] || `Speaker ${currentSpeaker}`;
              segments.push(`${charName}: "${currentWords.join(' ')}"`);
            }
            currentSpeaker = word.speaker;
            currentWords = [word.word];
          } else {
            currentWords.push(word.word);
          }
        }
        if (currentWords.length > 0) {
          const charName = mapping[currentSpeaker] || `Speaker ${currentSpeaker}`;
          segments.push(`${charName}: "${currentWords.join(' ')}"`);
        }
        
        asrInfo = segments.join('\n');
      } else {
        asrInfo = 'Нет речи (музыка/тишина)';
      }
    }
    
    // Описание от Gemini
    const generated = generatedEntries[sceneNum];
    const description = generated?.description || 'Нет описания';
    
    scenesData.push(`
СЦЕНА ${sceneNum}:
Таймкод: ${scene.start_timecode} - ${scene.end_timecode}
Описание (Gemini): ${description}
ASR (реплики): 
${asrInfo}
`);
  }
  
  // Персонажи
  const characters = chunkProgress.scriptData?.characters || [];
  const charactersText = characters.map(c => 
    `- ${c.name}${c.shortName ? ` (${c.shortName})` : ''}: ${c.description?.substring(0, 100) || 'нет описания'}...`
  ).join('\n');
  
  // Формируем промпт
  const prompt = VALIDATOR_PROMPT
    .replace('{scenes_data}', scenesData.join('\n---\n'))
    .replace('{characters}', charactersText);
  
  // Вызываем Gemini
  const token = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1;
  if (!token) {
    return NextResponse.json({ 
      error: 'No REPLICATE_API_TOKEN',
      // Возвращаем сырые данные для ручного анализа
      rawData: { scenesData, characters: charactersText }
    }, { status: 500 });
  }
  
  try {
    const replicate = new Replicate({ auth: token });
    
    const prediction = await replicate.predictions.create({
      model: 'google/gemini-2.5-flash',
      input: {
        prompt,
        max_output_tokens: 16000,
        temperature: 0.5,  // Меньше креативности, больше точности
      },
    });
    
    // Ждём результата
    let result = await replicate.predictions.get(prediction.id);
    let attempts = 0;
    
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await replicate.predictions.get(prediction.id);
      attempts++;
    }
    
    if (result.status === 'failed') {
      return NextResponse.json({ 
        error: 'Gemini failed',
        details: result.error,
        rawData: { scenesData, characters: charactersText }
      }, { status: 500 });
    }
    
    const output = Array.isArray(result.output) ? result.output.join('') : String(result.output);
    
    // Пытаемся распарсить JSON
    let validatedScenes = null;
    try {
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        validatedScenes = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Если не JSON — возвращаем как текст
    }
    
    return NextResponse.json({
      videoId,
      sceneRange: `${sceneStart}-${sceneEnd}`,
      
      // Валидированные сцены
      validated: validatedScenes,
      
      // Сырой ответ
      rawOutput: output,
      
      // Входные данные (для отладки)
      input: {
        scenesCount: scenesData.length,
        charactersCount: characters.length,
        hasDiarization: !!diarizationData,
        speakerMapping: mapping,
      },
    });
    
  } catch (err) {
    return NextResponse.json({ 
      error: 'Validation failed',
      details: err instanceof Error ? err.message : String(err),
      rawData: { scenesData, characters: charactersText }
    }, { status: 500 });
  }
}

