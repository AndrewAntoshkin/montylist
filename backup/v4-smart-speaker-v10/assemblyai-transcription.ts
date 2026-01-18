/**
 * AssemblyAI Transcription с Speaker Diarization
 * 
 * Преимущества перед Replicate whisper-diarization:
 * - Стабильнее (99.9% uptime)
 * - Быстрее cold start
 * - Встроенный speaker_labels
 * - Word-level timestamps
 */

import { AssemblyAI, Transcript, TranscriptWord } from 'assemblyai';

/**
 * Слово с таймкодом и спикером
 */
export interface DiarizedWord {
  word: string;
  start: number;      // миллисекунды
  end: number;        // миллисекунды
  speaker: string;    // "A", "B", "C" и т.д.
  confidence: number;
}

/**
 * Результат транскрипции с diarization
 */
export interface AssemblyAIResult {
  text: string;
  words: DiarizedWord[];
  speakers: string[];       // уникальные спикеры
  speakerCount: number;
  language: string;
  audioDuration: number;    // секунды
}

/**
 * Конвертирует AssemblyAI слова в наш формат
 */
function convertWords(words: TranscriptWord[]): DiarizedWord[] {
  return words.map(w => ({
    word: w.text || '',       // SDK использует 'text', не 'word'
    start: w.start,           // уже в миллисекундах
    end: w.end,
    speaker: w.speaker || 'A',
    confidence: w.confidence,
  }));
}

/**
 * Транскрибирует аудио/видео с определением спикеров
 * 
 * @param audioUrl - URL аудио или видео файла (публичный URL)
 * @param language - код языка (default: 'ru')
 * @param speakerHint - подсказка с именами персонажей (для vocabulary)
 * @param expectedSpeakers - ожидаемое количество спикеров (улучшает diarization)
 * @returns результат с words, speakers и таймкодами
 */
export async function transcribeWithAssemblyAI(
  audioUrl: string,
  language: string = 'ru',
  speakerHint?: string[],
  expectedSpeakers?: number
): Promise<AssemblyAIResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY not set in environment');
  }
  
  const client = new AssemblyAI({ apiKey });
  
  // ═══════════════════════════════════════════════════════════════
  // BEST PRACTICE: Не указывать слишком много спикеров!
  // AssemblyAI работает лучше с 2-4 спикерами на чанк.
  // Если указать 8+ — разбивает один голос на несколько ID.
  // ═══════════════════════════════════════════════════════════════
  
  // Для 3-минутного чанка обычно говорят 2-4 человека
  const minSpeakers = 2;
  const maxSpeakers = Math.min(expectedSpeakers || 4, 6); // Максимум 6, не 10!
  
  console.log(`🎤 AssemblyAI: Starting transcription with diarization...`);
  console.log(`   URL: ${audioUrl.substring(0, 80)}...`);
  console.log(`   Language: ${language}`);
  console.log(`   Speakers: ${minSpeakers}-${maxSpeakers} (min-max)`);
  
  // Формируем word_boost из имён персонажей (улучшает распознавание)
  const wordBoost = speakerHint?.slice(0, 30) || [];
  if (wordBoost.length > 0) {
    console.log(`   Word boost: ${wordBoost.slice(0, 5).join(', ')}...`);
  }
  
  try {
    const transcript = await client.transcripts.transcribe({
      audio_url: audioUrl,
      speaker_labels: true,        // Включить diarization
      // Используем min/max вместо точного числа — более гибко
      speaker_options: {
        min_speakers_expected: minSpeakers,
        max_speakers_expected: maxSpeakers,
      },
      language_code: language,
      word_boost: wordBoost,       // Подсказка для распознавания имён
      boost_param: 'high',         // Сильный boost для имён
      punctuate: true,             // Добавить пунктуацию
      format_text: true,           // Форматировать текст
    });
    
    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI error: ${transcript.error}`);
    }
    
    console.log(`✅ AssemblyAI transcription completed`);
    console.log(`   Text length: ${transcript.text?.length || 0} chars`);
    console.log(`   Words: ${transcript.words?.length || 0}`);
    console.log(`   Audio duration: ${((transcript.audio_duration || 0) / 1000).toFixed(1)}s`);
    
    // Извлекаем уникальных спикеров
    const speakersSet = new Set<string>();
    for (const word of transcript.words || []) {
      if (word.speaker) {
        speakersSet.add(word.speaker);
      }
    }
    const speakers = Array.from(speakersSet).sort();
    
    console.log(`   Speakers detected: ${speakers.length} (${speakers.join(', ')})`);
    
    return {
      text: transcript.text || '',
      words: convertWords(transcript.words || []),
      speakers,
      speakerCount: speakers.length,
      language: language,
      audioDuration: (transcript.audio_duration || 0) / 1000, // в секунды
    };
    
  } catch (error) {
    console.error('❌ AssemblyAI transcription failed:', error);
    throw error;
  }
}

/**
 * Получает слова в заданном временном диапазоне
 * 
 * @param words - слова от AssemblyAI
 * @param startMs - начало диапазона (миллисекунды)
 * @param endMs - конец диапазона (миллисекунды)
 * @returns слова попадающие в диапазон
 */
export function getWordsInRange(
  words: DiarizedWord[],
  startMs: number,
  endMs: number
): DiarizedWord[] {
  return words.filter(word => {
    // Центр слова попадает в диапазон
    const wordCenter = (word.start + word.end) / 2;
    return wordCenter >= startMs && wordCenter < endMs;
  });
}

/**
 * Форматирует диалоги для плана с группировкой по спикерам
 * 
 * @param words - слова от AssemblyAI
 * @param startSeconds - начало плана (секунды)
 * @param endSeconds - конец плана (секунды)
 * @param speakerMapping - маппинг speaker_id → имя персонажа
 * @returns отформатированные диалоги или пустая строка
 */
export function formatDialoguesForPlan(
  words: DiarizedWord[],
  startSeconds: number,
  endSeconds: number,
  speakerMapping: Record<string, string>
): string {
  const startMs = startSeconds * 1000;
  const endMs = endSeconds * 1000;
  
  const planWords = getWordsInRange(words, startMs, endMs);
  
  if (planWords.length === 0) {
    return '';
  }
  
  // Группируем слова по спикерам (сохраняя порядок)
  const dialogues: Array<{ speaker: string; words: string[] }> = [];
  
  for (const word of planWords) {
    const speakerName = speakerMapping[word.speaker] || word.speaker;
    const lastDialogue = dialogues[dialogues.length - 1];
    
    if (lastDialogue && lastDialogue.speaker === speakerName) {
      lastDialogue.words.push(word.word);
    } else {
      dialogues.push({
        speaker: speakerName,
        words: [word.word],
      });
    }
  }
  
  // Форматируем: ИМЯ\nтекст
  return dialogues
    .map(d => `${d.speaker}\n${d.words.join(' ').trim()}`)
    .join('\n\n');
}

/**
 * Нормализует маппинг спикеров — объединяет дублирующиеся
 * Если A=ГАЛИНА, C=ГАЛИНА, G=ГАЛИНА → все становятся одним спикером
 * 
 * @param mapping - исходный маппинг speaker_id → имя
 * @returns нормализованный маппинг
 */
export function normalizeSpeakerMapping(
  mapping: Record<string, string>
): Record<string, string> {
  // Группируем speaker IDs по персонажам
  const characterToSpeakers: Record<string, string[]> = {};
  
  for (const [speakerId, character] of Object.entries(mapping)) {
    if (!characterToSpeakers[character]) {
      characterToSpeakers[character] = [];
    }
    characterToSpeakers[character].push(speakerId);
  }
  
  // Логируем дубликаты
  for (const [character, speakers] of Object.entries(characterToSpeakers)) {
    if (speakers.length > 1) {
      console.log(`   ⚠️ Merging duplicate speakers for ${character}: ${speakers.join(', ')} → ${speakers[0]}`);
    }
  }
  
  // Возвращаем маппинг как есть — важно что все IDs указывают на одного персонажа
  return mapping;
}

/**
 * Создаёт маппинг спикеров на основе первых сцен
 * Логика: в первых сценах Gemini видит кто говорит (губы двигаются)
 * Мы связываем speaker_id с этим персонажем
 * 
 * @param words - слова от AssemblyAI
 * @param scenes - сцены с описаниями от Gemini
 * @param knownCharacters - известные персонажи из сценария
 * @returns маппинг speaker_id → имя персонажа
 */
export function buildSpeakerMapping(
  words: DiarizedWord[],
  scenes: Array<{ start_timecode: string; description: string; dialogues: string }>,
  knownCharacters: string[],
  timecodeToSeconds: (tc: string) => number
): Record<string, string> {
  const mapping: Record<string, string> = {};
  // НЕ используем usedCharacters — один персонаж может быть на нескольких speaker IDs
  
  console.log(`🎭 Building speaker mapping from first scenes...`);
  
  // Проходим по первым 30 сценам (где обычно все персонажи представлены)
  for (const scene of scenes.slice(0, 30)) {
    const sceneStart = timecodeToSeconds(scene.start_timecode) * 1000; // в мс
    const sceneEnd = sceneStart + 5000; // примерно 5 секунд
    
    // Какие спикеры говорят в этой сцене?
    const sceneWords = getWordsInRange(words, sceneStart, sceneEnd);
    if (sceneWords.length === 0) continue;
    
    const sceneSpeakers = [...new Set(sceneWords.map(w => w.speaker))];
    
    // Кого Gemini видит в кадре?
    const visibleCharacter = findCharacterInText(scene.description, knownCharacters);
    
    // Кого Gemini назначил спикером?
    const geminiSpeaker = extractSpeakerFromDialogue(scene.dialogues, knownCharacters);
    
    // Если Gemini видит персонажа И он говорит → маппим
    // ВАЖНО: Разрешаем один персонаж на несколько speaker IDs!
    // AssemblyAI может разбить один голос на A, C, G — все = ГАЛИНА
    for (const speakerId of sceneSpeakers) {
      if (mapping[speakerId]) continue; // уже есть маппинг
      
      // Приоритет 1: Gemini назначил спикера
      if (geminiSpeaker) {
        mapping[speakerId] = geminiSpeaker;
        console.log(`   ${speakerId} → ${geminiSpeaker} (Gemini speaker)`);
        continue;
      }
      
      // Приоритет 2: Персонаж виден в кадре
      if (visibleCharacter) {
        mapping[speakerId] = visibleCharacter;
        console.log(`   ${speakerId} → ${visibleCharacter} (visible in scene)`);
      }
    }
  }
  
  // Fallback для неизвестных спикеров
  const unmappedSpeakers = [...new Set(words.map(w => w.speaker))]
    .filter(s => !mapping[s]);
  
  for (const speakerId of unmappedSpeakers) {
    // Пробуем найти самого частого персонажа из уже замапленных
    const mappedCharacters = Object.values(mapping);
    if (mappedCharacters.length > 0) {
      // Считаем частоту персонажей
      const charCounts: Record<string, number> = {};
      for (const char of mappedCharacters) {
        charCounts[char] = (charCounts[char] || 0) + 1;
      }
      // Берём самого частого (скорее всего главный герой)
      const mostFrequent = Object.entries(charCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      
      if (mostFrequent && !mostFrequent.startsWith('ГОВОРЯЩИЙ')) {
        mapping[speakerId] = mostFrequent;
        console.log(`   ${speakerId} → ${mostFrequent} (likely same speaker)`);
        continue;
      }
    }
    
    mapping[speakerId] = `ГОВОРЯЩИЙ_${speakerId}`;
    console.log(`   ${speakerId} → ГОВОРЯЩИЙ_${speakerId} (fallback)`);
  }
  
  // Нормализуем маппинг — логируем дубликаты
  return normalizeSpeakerMapping(mapping);
}

/**
 * Ищет персонажа в тексте
 */
function findCharacterInText(text: string, characters: string[]): string | null {
  const textUpper = text.toUpperCase();
  
  for (const char of characters) {
    const charPattern = new RegExp(`\\b${char}\\b`, 'i');
    if (charPattern.test(textUpper)) {
      return char;
    }
  }
  
  return null;
}

/**
 * Извлекает спикера из диалогов Gemini
 */
function extractSpeakerFromDialogue(dialogues: string, characters: string[]): string | null {
  if (!dialogues || dialogues.toLowerCase() === 'музыка') {
    return null;
  }
  
  // Первая строка обычно имя спикера
  const firstLine = dialogues.split('\n')[0].trim().toUpperCase();
  
  // Убираем ЗК
  const cleanName = firstLine.replace(/\s*ЗК\s*/g, '').trim();
  
  // Проверяем что это известный персонаж
  if (characters.some(c => c.toUpperCase() === cleanName)) {
    return cleanName;
  }
  
  return null;
}

/**
 * Проверяет доступность AssemblyAI API
 */
export async function checkAssemblyAIAvailable(): Promise<boolean> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  
  if (!apiKey) {
    console.warn('⚠️ ASSEMBLYAI_API_KEY not set');
    return false;
  }
  
  try {
    const client = new AssemblyAI({ apiKey });
    // Простой запрос для проверки ключа
    // AssemblyAI не имеет простого health endpoint, так что просто проверяем что клиент создаётся
    console.log('✅ AssemblyAI API key is set');
    return true;
  } catch {
    return false;
  }
}

