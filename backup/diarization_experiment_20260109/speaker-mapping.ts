/**
 * Speaker Mapping — сопоставление SPEAKER_XX с именами персонажей
 * 
 * Использует Gemini для визуального определения кто говорит:
 * 1. Смотрит видео в моменты когда спикер говорит
 * 2. Сравнивает с описаниями персонажей из сценария
 * 3. Определяет роль по контексту если персонаж неизвестен
 */

import Replicate from 'replicate';
import type { DiarizedSegment } from './whisper-diarization';
import { getFirstUtterancePerSpeaker } from './whisper-diarization';

/**
 * Маппинг speaker_id → имя персонажа
 */
export type SpeakerMapping = Record<string, string>;

/**
 * Персонаж из сценария
 */
export interface Character {
  name: string;
  description?: string;
  gender?: 'male' | 'female';
  dialogueCount?: number;
}

/**
 * Результат маппинга с дополнительной информацией
 */
export interface MappingResult {
  mapping: SpeakerMapping;
  newCharacters: Array<{
    speakerId: string;
    name: string;
    description: string;
  }>;
  confidence: Record<string, number>; // 0-1 уверенность в маппинге
}

// Модель AI для маппинга
const AI_MODEL = 'google/gemini-3-pro';

/**
 * Конвертирует секунды в таймкод HH:MM:SS:FF
 */
function secondsToTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 25);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

/**
 * Создаёт промпт для маппинга спикеров
 */
function createMappingPrompt(
  speakerSamples: Map<string, { text: string; start: number; end: number }>,
  characters: Character[]
): string {
  // Форматируем персонажей
  const characterList = characters.length > 0
    ? characters.map(c => {
        const gender = c.gender === 'female' ? '(жен.)' : c.gender === 'male' ? '(муж.)' : '';
        const desc = c.description ? `: ${c.description}` : '';
        return `• ${c.name} ${gender}${desc}`;
      }).join('\n')
    : '(персонажи не указаны)';
  
  // Форматируем спикеров
  const speakerList = [...speakerSamples.entries()]
    .map(([id, sample]) => {
      const tc = secondsToTimecode(sample.start);
      const text = sample.text.length > 60 ? sample.text.slice(0, 60) + '...' : sample.text;
      return `• ${id} (${tc}): "${text}"`;
    })
    .join('\n');
  
  return `Определи персонажей по голосам в видео.

═══════════════════════════════════════════════════════════
ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ:
═══════════════════════════════════════════════════════════
${characterList}

═══════════════════════════════════════════════════════════
СПИКЕРЫ ДЛЯ ОПРЕДЕЛЕНИЯ:
═══════════════════════════════════════════════════════════
${speakerList}

═══════════════════════════════════════════════════════════
ИНСТРУКЦИЯ:
═══════════════════════════════════════════════════════════

1. Для каждого спикера найди момент в видео (таймкод указан)
2. Посмотри ЧЬИ ГУБЫ ДВИГАЮТСЯ синхронно с речью
3. Сравни внешность с описаниями персонажей выше
4. Если персонаж из списка — используй его ИМЯ
5. Если персонажа НЕТ в списке — определи РОЛЬ:
   • ОФИЦИАНТ, ОФИЦИАНТКА
   • ВРАЧ, МЕДСЕСТРА
   • КЛИЕНТ, КЛИЕНТКА
   • ПРОДАВЕЦ, ПРОДАВЩИЦА
   • МУЖЧИНА, ЖЕНЩИНА (если роль неясна)

═══════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА (строго JSON):
═══════════════════════════════════════════════════════════

{
  "mapping": {
    "SPEAKER_00": "ИМЯ_ИЛИ_РОЛЬ",
    "SPEAKER_01": "ИМЯ_ИЛИ_РОЛЬ"
  },
  "new_characters": [
    {
      "speaker_id": "SPEAKER_02",
      "name": "ОФИЦИАНТКА",
      "description": "Женщина ~25 лет в фартуке"
    }
  ]
}

Отвечай ТОЛЬКО JSON, без дополнительного текста.`;
}

/**
 * Извлекает JSON из ответа AI
 */
function extractJson(text: string): string | null {
  // Ищем JSON в ответе
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

/**
 * Создаёт маппинг спикеров через Gemini
 * 
 * @param videoUrl - URL видео чанка
 * @param segments - сегменты от diarization
 * @param characters - персонажи из сценария
 * @param replicate - клиент Replicate (опционально)
 * @returns маппинг и информация о новых персонажах
 */
export async function createSpeakerMapping(
  videoUrl: string,
  segments: DiarizedSegment[],
  characters: Character[],
  replicateClient?: Replicate
): Promise<MappingResult> {
  const replicate = replicateClient || new Replicate({
    auth: process.env.REPLICATE_API_TOKEN_1!,
  });
  
  // Получаем первую реплику каждого спикера
  const speakerSamples = getFirstUtterancePerSpeaker(segments);
  
  if (speakerSamples.size === 0) {
    console.warn('⚠️ No speakers found in segments');
    return {
      mapping: {},
      newCharacters: [],
      confidence: {},
    };
  }
  
  console.log(`🎭 Creating speaker mapping for ${speakerSamples.size} speakers...`);
  
  // Создаём промпт
  const prompt = createMappingPrompt(speakerSamples, characters);
  
  try {
    // Вызываем Gemini с видео (с retry логикой)
    let prediction;
    let lastError: Error | null = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🎭 Mapping attempt ${attempt}/${maxRetries}...`);
        
        prediction = await replicate.run(AI_MODEL, {
          input: {
            videos: [videoUrl],
            prompt,
          },
        });
        
        console.log(`✅ Gemini mapping succeeded on attempt ${attempt}`);
        break;
      } catch (error: any) {
        lastError = error;
        console.warn(`⚠️ Mapping attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          const waitTime = Math.pow(attempt, 2) * 2000; // 2s, 8s
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    if (!prediction) {
      throw lastError || new Error('Failed to get mapping from Gemini');
    }
    
    const output = Array.isArray(prediction) ? prediction.join('') : String(prediction);
    console.log(`📝 Gemini response: ${output.substring(0, 200)}...`);
    
    // Извлекаем JSON
    const jsonStr = extractJson(output);
    if (!jsonStr) {
      console.warn('⚠️ No JSON found in response, using fallback');
      return createFallbackMapping(speakerSamples);
    }
    
    const result = JSON.parse(jsonStr);
    
    // Валидируем и нормализуем маппинг
    const mapping: SpeakerMapping = {};
    const confidence: Record<string, number> = {};
    const knownNames = new Set(characters.map(c => c.name.toUpperCase()));
    
    for (const [speakerId, name] of Object.entries(result.mapping || {})) {
      const normalizedName = String(name).toUpperCase().trim();
      mapping[speakerId] = normalizedName;
      
      // Уверенность выше если имя из списка персонажей
      confidence[speakerId] = knownNames.has(normalizedName) ? 0.9 : 0.6;
    }
    
    // Обрабатываем новых персонажей
    const newCharacters = (result.new_characters || []).map((nc: { speaker_id: string; name: string; description: string }) => ({
      speakerId: nc.speaker_id,
      name: String(nc.name).toUpperCase().trim(),
      description: nc.description || '',
    }));
    
    console.log(`✅ Speaker mapping created:`);
    for (const [id, name] of Object.entries(mapping)) {
      console.log(`   ${id} → ${name} (confidence: ${(confidence[id] * 100).toFixed(0)}%)`);
    }
    
    return { mapping, newCharacters, confidence };
    
  } catch (error) {
    console.error('❌ Speaker mapping failed:', error);
    return createFallbackMapping(speakerSamples);
  }
}

/**
 * Создаёт fallback маппинг если AI не смог определить
 */
function createFallbackMapping(
  speakerSamples: Map<string, { text: string; start: number; end: number }>
): MappingResult {
  const mapping: SpeakerMapping = {};
  const confidence: Record<string, number> = {};
  
  let speakerNum = 1;
  for (const speakerId of speakerSamples.keys()) {
    mapping[speakerId] = `ГОВОРЯЩИЙ ${speakerNum}`;
    confidence[speakerId] = 0.3;
    speakerNum++;
  }
  
  console.log(`⚠️ Using fallback mapping: ${JSON.stringify(mapping)}`);
  
  return {
    mapping,
    newCharacters: [],
    confidence,
  };
}

/**
 * Проверяет есть ли новые спикеры которых нет в маппинге
 */
export function hasNewSpeakers(
  segments: DiarizedSegment[],
  existingMapping: SpeakerMapping
): boolean {
  for (const seg of segments) {
    if (!existingMapping[seg.speaker]) {
      return true;
    }
  }
  return false;
}

/**
 * Дополняет существующий маппинг новыми спикерами
 */
export async function updateSpeakerMapping(
  videoUrl: string,
  segments: DiarizedSegment[],
  existingMapping: SpeakerMapping,
  characters: Character[],
  replicateClient?: Replicate
): Promise<MappingResult> {
  // Находим только новых спикеров
  const newSpeakers = new Set<string>();
  for (const seg of segments) {
    if (!existingMapping[seg.speaker]) {
      newSpeakers.add(seg.speaker);
    }
  }
  
  if (newSpeakers.size === 0) {
    return {
      mapping: existingMapping,
      newCharacters: [],
      confidence: {},
    };
  }
  
  console.log(`🆕 Found ${newSpeakers.size} new speakers: ${[...newSpeakers].join(', ')}`);
  
  // Фильтруем сегменты только с новыми спикерами
  const newSegments = segments.filter(seg => newSpeakers.has(seg.speaker));
  
  // Создаём маппинг для новых
  const newMapping = await createSpeakerMapping(
    videoUrl,
    newSegments,
    characters,
    replicateClient
  );
  
  // Объединяем маппинги
  return {
    mapping: { ...existingMapping, ...newMapping.mapping },
    newCharacters: newMapping.newCharacters,
    confidence: newMapping.confidence,
  };
}

/**
 * Применяет маппинг коротких имён (ГАЛИНА → ГАЛЯ)
 */
const SHORT_NAMES: Record<string, string> = {
  'ГАЛИНА': 'ГАЛЯ',
  'ТАТЬЯНА': 'ТАНЯ',
  'СВЕТЛАНА': 'СВЕТА',
  'ЕЛЕНА': 'ЛЕНА',
  'ТАМАРА': 'ТОМА',
  'АЛЕКСАНДРА': 'ШУРА',
  'ЛЮДМИЛА': 'ЛЮДА',
  'НАТАЛЬЯ': 'НАТАША',
  'ЕКАТЕРИНА': 'КАТЯ',
  'АНАСТАСИЯ': 'НАСТЯ',
  'МАРИЯ': 'МАША',
  'ОЛЬГА': 'ОЛЯ',
  'ВАЛЕНТИНА': 'ВАЛЯ',
  'ВЛАДИМИР': 'ВОВА',
  'АЛЕКСАНДР': 'САША',
  'ДМИТРИЙ': 'ДИМА',
  'МИХАИЛ': 'МИША',
  'НИКОЛАЙ': 'КОЛЯ',
  'СЕРГЕЙ': 'СЕРЁЖА',
};

export function normalizeToShortName(name: string): string {
  const upper = name.toUpperCase().trim();
  return SHORT_NAMES[upper] || upper;
}

/**
 * Нормализует все имена в маппинге к коротким формам
 */
export function normalizeMappingNames(mapping: SpeakerMapping): SpeakerMapping {
  const normalized: SpeakerMapping = {};
  for (const [speakerId, name] of Object.entries(mapping)) {
    normalized[speakerId] = normalizeToShortName(name);
  }
  return normalized;
}

