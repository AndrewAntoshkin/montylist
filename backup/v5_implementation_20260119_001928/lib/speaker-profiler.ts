/**
 * Speaker Profiler v2
 * 
 * Комбинированный подход для определения персонажей:
 * 1. AssemblyAI разделяет голоса → Speaker A, B, C
 * 2. Анализируем текст каждого спикера (слова, обращения, стиль)
 * 3. Сопоставляем с профилями персонажей из сценария
 * 4. Gemini как дополнительная валидация
 * 5. Калибровка из титров видео (v2)
 */

import type { ScriptCharacterInfo } from '@/types';

/**
 * Профиль голоса (speaker) на основе его реплик
 */
export interface SpeakerProfile {
  speakerId: string;           // A, B, C...
  wordCount: number;           // Сколько слов сказал
  uniqueWords: Set<string>;    // Уникальные слова
  mentionedNames: string[];    // Имена которые упоминает ("Галь", "Юсеф")
  addressedAs: string[];       // Как к нему обращаются
  speechStyle: {
    avgWordLength: number;     // Средняя длина слова (простая/сложная речь)
    exclamations: number;      // Восклицания (эмоциональность)
    questions: number;         // Вопросы
    diminutives: number;       // Уменьшительные ("Галочка", "девочки")
  };
  timecodes: Array<{           // Когда говорит
    start: number;
    end: number;
  }>;
  confidence: number;          // Уверенность в идентификации (0-1)
  matchedCharacter?: string;   // Определённый персонаж
}

/**
 * Профиль персонажа из сценария
 */
export interface CharacterProfile {
  name: string;
  shortNames: string[];        // ГАЛЯ, ГАЛИНА, ГАЛОЧКА
  gender: 'м' | 'ж' | 'unknown';
  speechTraits: string[];      // Из сценария: "проста", "провинциальна", "акцент"
  knownPhrases: string[];      // Характерные фразы
}

/**
 * Слово с информацией о спикере
 */
export interface SpeakerWord {
  word: string;
  start: number;
  end: number;
  speaker: string;
}

// ═══════════════════════════════════════════════════════════════
// ХАРАКТЕРНЫЕ СЛОВА И ПАТТЕРНЫ
// ═══════════════════════════════════════════════════════════════

// Уменьшительные суффиксы (признак женской/эмоциональной речи)
const DIMINUTIVE_PATTERNS = [
  /очк[аи]$/i, /ечк[аи]$/i, /еньк[аи]$/i, /оньк[аи]$/i,
  /ушк[аи]$/i, /юшк[аи]$/i, /ик$/i, /чик$/i,
];

// Обращения (помогают определить КТО говорит с КЕМ)
const NAME_PATTERNS = [
  // Женские имена
  { pattern: /\bгал[яьи]?\b/i, name: 'ГАЛЯ' },
  { pattern: /\bгалин[ауе]?\b/i, name: 'ГАЛЯ' },
  { pattern: /\bгалочк[ауе]?\b/i, name: 'ГАЛЯ' },
  { pattern: /\bбэлл[ауе]?\b/i, name: 'БЭЛЛА' },
  { pattern: /\bтом[ауе]?\b/i, name: 'ТОМА' },
  { pattern: /\bтань[як]?\b/i, name: 'ТАНЯ' },
  { pattern: /\bшурочк[ауе]?\b/i, name: 'ШУРОЧКА' },
  { pattern: /\bлюдас[яи]?\b/i, name: 'ЛЮДАСЯ' },
  { pattern: /\bсвет[ауе]?\b/i, name: 'СВЕТА' },
  { pattern: /\bварвар[ауе]?\b/i, name: 'ВАРВАРА' },
  { pattern: /\bвар[яьи]?\b/i, name: 'ВАРЯ' },
  // Мужские имена
  { pattern: /\bюсеф\b/i, name: 'ЮСЕФ' },
  { pattern: /\bюсефчик\b/i, name: 'ЮСЕФ' },
  { pattern: /\bмохаммед\b/i, name: 'МОХАММЕД' },
  { pattern: /\bмухаммед\b/i, name: 'МОХАММЕД' },
  // Общие обращения
  { pattern: /\bдевочки\b/i, name: '_FEMALE_GROUP' },
  { pattern: /\bдевчонки\b/i, name: '_FEMALE_GROUP' },
];

// Простые/разговорные слова (признак простой речи — ГАЛЯ)
const SIMPLE_SPEECH_WORDS = [
  'ну', 'вот', 'типа', 'короче', 'блин', 'ага', 'угу', 'ой',
  'чё', 'че', 'щас', 'ваще', 'прям', 'токо', 'тока',
];

// ═══════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════

/**
 * Создаёт профили всех спикеров на основе их реплик
 */
export function buildSpeakerProfiles(
  words: SpeakerWord[]
): Map<string, SpeakerProfile> {
  const profiles = new Map<string, SpeakerProfile>();
  
  // Группируем слова по спикерам
  const speakerWords = new Map<string, SpeakerWord[]>();
  for (const word of words) {
    if (!speakerWords.has(word.speaker)) {
      speakerWords.set(word.speaker, []);
    }
    speakerWords.get(word.speaker)!.push(word);
  }
  
  // Создаём профиль для каждого спикера
  for (const [speakerId, speakerWordList] of speakerWords) {
    const profile = analyzeSpeakerWords(speakerId, speakerWordList, words);
    profiles.set(speakerId, profile);
  }
  
  return profiles;
}

/**
 * Анализирует слова одного спикера и создаёт профиль
 */
function analyzeSpeakerWords(
  speakerId: string,
  speakerWords: SpeakerWord[],
  allWords: SpeakerWord[]
): SpeakerProfile {
  const text = speakerWords.map(w => w.word).join(' ');
  const uniqueWords = new Set(speakerWords.map(w => w.word.toLowerCase()));
  
  // Считаем характеристики речи
  let exclamations = 0;
  let questions = 0;
  let diminutives = 0;
  let totalWordLength = 0;
  
  for (const word of speakerWords) {
    const w = word.word;
    totalWordLength += w.length;
    
    if (w.includes('!')) exclamations++;
    if (w.includes('?')) questions++;
    
    for (const pattern of DIMINUTIVE_PATTERNS) {
      if (pattern.test(w)) {
        diminutives++;
        break;
      }
    }
  }
  
  // Ищем упомянутые имена (кого спикер называет)
  const mentionedNames: string[] = [];
  for (const { pattern, name } of NAME_PATTERNS) {
    if (pattern.test(text) && name !== '_FEMALE_GROUP') {
      mentionedNames.push(name);
    }
  }
  
  // Ищем как к спикеру обращаются (в речи ДРУГИХ спикеров рядом)
  const addressedAs = findHowAddressed(speakerId, speakerWords, allWords);
  
  // Собираем таймкоды
  const timecodes = speakerWords.map(w => ({ start: w.start, end: w.end }));
  
  return {
    speakerId,
    wordCount: speakerWords.length,
    uniqueWords,
    mentionedNames: [...new Set(mentionedNames)],
    addressedAs: [...new Set(addressedAs)],
    speechStyle: {
      avgWordLength: totalWordLength / speakerWords.length,
      exclamations,
      questions,
      diminutives,
    },
    timecodes,
    confidence: 0,
  };
}

/**
 * Ищет как к спикеру обращаются другие
 * Логика: если Speaker B говорит "Галь, ты..." а потом отвечает Speaker A,
 * то Speaker A вероятно ГАЛЯ
 */
function findHowAddressed(
  speakerId: string,
  speakerWords: SpeakerWord[],
  allWords: SpeakerWord[]
): string[] {
  const addressed: string[] = [];
  
  // Для каждого момента когда спикер начинает говорить
  for (const firstWord of speakerWords) {
    // Ищем слова ДРУГИХ спикеров перед этим (в пределах 3 секунд)
    const beforeWords = allWords.filter(w => 
      w.speaker !== speakerId &&
      w.end < firstWord.start &&
      w.end > firstWord.start - 3000 // 3 секунды до
    );
    
    // Проверяем есть ли обращение
    const beforeText = beforeWords.map(w => w.word).join(' ');
    for (const { pattern, name } of NAME_PATTERNS) {
      if (pattern.test(beforeText) && name !== '_FEMALE_GROUP') {
        addressed.push(name);
      }
    }
  }
  
  return addressed;
}

/**
 * Сопоставляет профили спикеров с персонажами из сценария
 */
export function matchSpeakersToCharacters(
  speakerProfiles: Map<string, SpeakerProfile>,
  scriptCharacters: ScriptCharacterInfo[],
  geminiHints: Map<string, string> // speaker -> character из Gemini
): Map<string, string> {
  const mapping = new Map<string, string>();
  const usedCharacters = new Set<string>();
  
  console.log(`\n🎭 SPEAKER PROFILER v1: Matching speakers to characters...`);
  
  // Создаём профили персонажей из сценария
  const characterProfiles = createCharacterProfiles(scriptCharacters);
  
  // Сортируем спикеров по количеству слов (главные герои говорят больше)
  const sortedSpeakers = [...speakerProfiles.entries()]
    .sort((a, b) => b[1].wordCount - a[1].wordCount);
  
  for (const [speakerId, profile] of sortedSpeakers) {
    let bestMatch: string | null = null;
    let bestScore = 0;
    
    for (const charProfile of characterProfiles) {
      if (usedCharacters.has(charProfile.name)) continue;
      
      const score = calculateMatchScore(profile, charProfile, geminiHints.get(speakerId));
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = charProfile.name;
      }
    }
    
    if (bestMatch && bestScore > 0.3) {
      mapping.set(speakerId, bestMatch);
      usedCharacters.add(bestMatch);
      profile.matchedCharacter = bestMatch;
      profile.confidence = bestScore;
      
      console.log(`   ${speakerId} → ${bestMatch} (score: ${(bestScore * 100).toFixed(0)}%, words: ${profile.wordCount})`);
      
      // Логируем почему
      if (profile.addressedAs.includes(bestMatch)) {
        console.log(`      ↳ Others call them "${bestMatch}"`);
      }
      if (geminiHints.get(speakerId) === bestMatch) {
        console.log(`      ↳ Gemini confirmed visually`);
      }
    } else {
      // Fallback — используем Gemini hint если есть
      const geminiHint = geminiHints.get(speakerId);
      if (geminiHint && !usedCharacters.has(geminiHint)) {
        mapping.set(speakerId, geminiHint);
        usedCharacters.add(geminiHint);
        profile.matchedCharacter = geminiHint;
        profile.confidence = 0.5;
        console.log(`   ${speakerId} → ${geminiHint} (Gemini fallback, words: ${profile.wordCount})`);
      } else {
        mapping.set(speakerId, `ГОВОРЯЩИЙ_${speakerId}`);
        console.log(`   ${speakerId} → ГОВОРЯЩИЙ_${speakerId} (no match, words: ${profile.wordCount})`);
      }
    }
  }
  
  return mapping;
}

/**
 * Создаёт профили персонажей из сценария
 */
function createCharacterProfiles(characters: ScriptCharacterInfo[]): CharacterProfile[] {
  const profiles: CharacterProfile[] = [];
  
  for (const char of characters) {
    if (!char.name) continue;
    
    const name = char.name.toUpperCase();
    const description = (char.description || '').toLowerCase();
    
    // Определяем пол
    let gender: 'м' | 'ж' | 'unknown' = 'unknown';
    if (description.includes('женщин') || description.includes('блондинк') || 
        description.includes('девушк') || char.gender === 'female') {
      gender = 'ж';
    } else if (description.includes('мужчин') || description.includes('араб') || 
               char.gender === 'male') {
      gender = 'м';
    }
    
    // Извлекаем характеристики речи
    const speechTraits: string[] = [];
    if (description.includes('прост')) speechTraits.push('простая речь');
    if (description.includes('провинциальн')) speechTraits.push('провинциальная');
    if (description.includes('акцент')) speechTraits.push('акцент');
    if (description.includes('эмоциональн')) speechTraits.push('эмоциональная');
    
    // Короткие формы имени
    const shortNames = [name];
    if (name === 'ГАЛИНА') shortNames.push('ГАЛЯ', 'ГАЛОЧКА');
    if (name === 'ТАТЬЯНА') shortNames.push('ТАНЯ', 'ТАНЬКА');
    if (name === 'ВАРВАРА') shortNames.push('ВАРЯ');
    
    profiles.push({
      name,
      shortNames,
      gender,
      speechTraits,
      knownPhrases: [],
    });
  }
  
  return profiles;
}

/**
 * Рассчитывает score совпадения спикера с персонажем
 */
function calculateMatchScore(
  speaker: SpeakerProfile,
  character: CharacterProfile,
  geminiHint?: string
): number {
  let score = 0;
  
  // 1. Gemini hint (если совпадает) — +0.4
  if (geminiHint && character.shortNames.some(n => 
    n.toUpperCase() === geminiHint.toUpperCase()
  )) {
    score += 0.4;
  }
  
  // 2. Другие обращаются к спикеру этим именем — +0.5 (самый надёжный!)
  if (speaker.addressedAs.some(addr => 
    character.shortNames.some(n => n.toUpperCase() === addr.toUpperCase())
  )) {
    score += 0.5;
  }
  
  // 3. Характеристики речи
  const text = [...speaker.uniqueWords].join(' ').toLowerCase();
  
  // Простая речь — ГАЛЯ
  if (character.speechTraits.includes('простая речь')) {
    const simpleWordCount = SIMPLE_SPEECH_WORDS.filter(w => text.includes(w)).length;
    if (simpleWordCount >= 2) score += 0.2;
  }
  
  // Много восклицаний — эмоциональный персонаж
  if (character.speechTraits.includes('эмоциональная')) {
    if (speaker.speechStyle.exclamations >= 2) score += 0.1;
  }
  
  // 4. Количество слов (главные герои говорят больше)
  // Если спикер говорит много — это скорее главный герой
  if (speaker.wordCount > 50) {
    score += 0.05; // Небольшой бонус за активность
  }
  
  return Math.min(score, 1.0);
}

/**
 * Извлекает hints от Gemini из parsed scenes
 */
export function extractGeminiHints(
  scenes: Array<{ start_timecode: string; dialogues: string }>,
  speakerWords: SpeakerWord[],
  timecodeToSeconds: (tc: string) => number
): Map<string, string> {
  const hints = new Map<string, string>();
  
  for (const scene of scenes) {
    // Извлекаем имя спикера из диалога Gemini
    const match = scene.dialogues.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,15})(?:\s*ЗК)?[\n\r]/);
    if (!match) continue;
    
    const geminiSpeaker = match[1].toUpperCase();
    const sceneStart = timecodeToSeconds(scene.start_timecode) * 1000;
    const sceneEnd = sceneStart + 5000;
    
    // Какой speaker говорит в это время?
    const sceneWords = speakerWords.filter(w => 
      w.start >= sceneStart && w.end <= sceneEnd
    );
    
    if (sceneWords.length === 0) continue;
    
    // Находим доминантного спикера
    const speakerCounts: Record<string, number> = {};
    for (const w of sceneWords) {
      speakerCounts[w.speaker] = (speakerCounts[w.speaker] || 0) + 1;
    }
    
    const dominantSpeaker = Object.entries(speakerCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    
    if (dominantSpeaker && !hints.has(dominantSpeaker)) {
      hints.set(dominantSpeaker, geminiSpeaker);
    }
  }
  
  return hints;
}

// ═══════════════════════════════════════════════════════════════
// КАЛИБРОВКА ИЗ ТИТРОВ ВИДЕО
// ═══════════════════════════════════════════════════════════════

/**
 * Информация о персонаже из титров видео
 */
export interface TitleCalibration {
  characterName: string;   // ТОМА
  actorName: string;       // Елена Доронина
  timecode: string;        // Когда появился титр
}

/**
 * Извлекает информацию о персонажах из титров видео
 * Парсит ответ Gemini для первого чанка (заставка)
 * 
 * Формат титров: "Титр: ТОМА — Елена Доронина" или "Титр «ТОМА — Елена Доронина»"
 */
export function extractCharactersFromTitles(geminiResponse: string): TitleCalibration[] {
  const calibrations: TitleCalibration[] = [];
  
  // Паттерны для титров
  const titlePatterns = [
    // "Титр: Тома – Елена Доронина" или "Титр: Тома Елена Доронина"
    /Титр[:\s]+([А-ЯЁа-яё]+)\s*[-–—]\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/gi,
    // "Титр «Тома – Елена Доронина»"
    /Титр[:\s]*[«"]([А-ЯЁа-яё]+)\s*[-–—]\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)[»"]/gi,
    // "Шурочка Татьяна Рыбинец" — без слова "Титр"
    /^([А-ЯЁа-яё]+)\s+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)$/gm,
  ];
  
  for (const pattern of titlePatterns) {
    let match;
    while ((match = pattern.exec(geminiResponse)) !== null) {
      const characterName = match[1].toUpperCase().trim();
      const actorName = match[2].trim();
      
      // Проверяем что это похоже на имя персонажа + имя актёра
      if (characterName.length >= 2 && characterName.length <= 15 && 
          actorName.length >= 5 && actorName.length <= 40) {
        // Проверяем что это не техническое слово
        const excludeWords = ['РЕЖИССЕР', 'ПРОДЮСЕР', 'ОПЕРАТОР', 'СЦЕНАРИЙ', 'МУЗЫКА', 'МОНТАЖ'];
        if (!excludeWords.includes(characterName)) {
          calibrations.push({
            characterName,
            actorName,
            timecode: '',
          });
          console.log(`   📺 Title calibration: ${characterName} — ${actorName}`);
        }
      }
    }
  }
  
  return calibrations;
}

/**
 * Калибрует маппинг Speaker → Character используя визуальную информацию из первых сцен
 * 
 * Логика:
 * 1. В первых сценах после титров Gemini видит персонажа и пишет его имя
 * 2. ASR определяет какой Speaker говорит в этот момент
 * 3. Связываем: Speaker A = персонаж которого видит Gemini
 */
export function calibrateSpeakersFromFirstScenes(
  scenes: Array<{ 
    start_timecode: string; 
    end_timecode: string; 
    description: string; 
    dialogues: string;
  }>,
  speakerWords: SpeakerWord[],
  knownCharacters: string[],
  timecodeToSeconds: (tc: string) => number
): Map<string, string> {
  const calibration = new Map<string, string>();
  const usedCharacters = new Set<string>();
  
  console.log(`   🎯 Calibrating speakers from first scenes...`);
  
  // Берём первые 10 сцен с диалогами
  const scenesWithDialogue = scenes
    .filter(s => s.dialogues && s.dialogues.toLowerCase() !== 'музыка')
    .slice(0, 10);
  
  for (const scene of scenesWithDialogue) {
    // Кого Gemini видит в кадре?
    const descUpper = scene.description.toUpperCase();
    const visibleCharacter = knownCharacters.find(c => 
      new RegExp(`\\b${c}\\b`, 'i').test(descUpper)
    );
    
    if (!visibleCharacter || usedCharacters.has(visibleCharacter)) continue;
    
    // Кто говорит в этой сцене по ASR?
    const sceneStartMs = timecodeToSeconds(scene.start_timecode) * 1000;
    const sceneEndMs = timecodeToSeconds(scene.end_timecode) * 1000;
    
    const sceneWords = speakerWords.filter(w => 
      w.start >= sceneStartMs - 500 && w.end <= sceneEndMs + 500
    );
    
    if (sceneWords.length < 3) continue;
    
    // Находим доминантного спикера
    const speakerCounts: Record<string, number> = {};
    for (const w of sceneWords) {
      speakerCounts[w.speaker] = (speakerCounts[w.speaker] || 0) + 1;
    }
    
    const dominantSpeaker = Object.entries(speakerCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    
    // Если спикер ещё не привязан — калибруем
    if (dominantSpeaker && !calibration.has(dominantSpeaker)) {
      // Дополнительная проверка: Gemini тоже определил этого персонажа?
      const geminiDialogue = scene.dialogues.toUpperCase();
      const geminiSpeaker = knownCharacters.find(c => geminiDialogue.startsWith(c));
      
      // Если Gemini и визуал совпадают — высокая уверенность
      if (geminiSpeaker === visibleCharacter || !geminiSpeaker) {
        calibration.set(dominantSpeaker, visibleCharacter);
        usedCharacters.add(visibleCharacter);
        console.log(`   ✅ Calibrated: Speaker ${dominantSpeaker} = ${visibleCharacter} (from scene ${scene.start_timecode})`);
      }
    }
  }
  
  return calibration;
}

/**
 * Сохраняет калибровку для использования в последующих чанках
 */
export interface ChunkCalibrationData {
  speakerToCharacter: Record<string, string>;  // A→ГАЛЯ, B→ЮСЕФ
  characterToSpeaker: Record<string, string>;  // ГАЛЯ→A, ЮСЕФ→B
  titlesFound: TitleCalibration[];
  lastSpeaker: string;                          // Последний говоривший
  timestamp: number;
}

export function createCalibrationData(
  speakerMapping: Map<string, string>,
  titles: TitleCalibration[],
  lastSpeaker: string
): ChunkCalibrationData {
  const speakerToCharacter: Record<string, string> = {};
  const characterToSpeaker: Record<string, string> = {};
  
  for (const [speaker, character] of speakerMapping) {
    speakerToCharacter[speaker] = character;
    characterToSpeaker[character] = speaker;
  }
  
  return {
    speakerToCharacter,
    characterToSpeaker,
    titlesFound: titles,
    lastSpeaker,
    timestamp: Date.now(),
  };
}

