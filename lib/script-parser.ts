/**
 * Script Parser Module
 * 
 * Парсит сценарии в форматах DOC, DOCX и TXT.
 * Извлекает структуру: персонажи, диалоги, ремарки, сцены.
 */

import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

export interface ScriptDialogue {
  speaker: string;           // Имя персонажа (ТОМА, ГАЛЯ)
  text: string;              // Текст реплики
  isVoiceover?: boolean;     // Голос за кадром
  lineNumber?: number;       // Номер строки в сценарии
}

export interface ScriptScene {
  sceneNumber?: number;      // Номер сцены
  location?: string;         // Локация (ИНТ. САЛОН КРАСОТЫ)
  timeOfDay?: string;        // Время суток (ДЕНЬ, НОЧЬ)
  description?: string;      // Описание сцены
  dialogues: ScriptDialogue[];
}

export interface ScriptCharacter {
  name: string;              // Имя персонажа (заглавными)
  normalizedName: string;    // Нормализованное имя
  dialogueCount: number;     // Количество реплик
  firstAppearance?: number;  // Номер первой сцены
  description?: string;      // Описание из сценария (если есть)
  gender?: 'male' | 'female' | 'unknown';
  variants: string[];        // Варианты имени (ГАЛЯ, ГАЛИНА, ГАЛОЧКА)
}

export interface ParsedScript {
  title?: string;            // Название
  scenes: ScriptScene[];     // Сцены
  characters: ScriptCharacter[];  // Персонажи
  rawText: string;           // Исходный текст
  format: 'standard' | 'freeform';  // Формат сценария
}

// ═══════════════════════════════════════════════════════════════
// Паттерны для парсинга сценария
// ═══════════════════════════════════════════════════════════════

// Заголовок сцены: "1. ИНТ. САЛОН КРАСОТЫ - ДЕНЬ" или "СЦЕНА 1"
const SCENE_HEADER_PATTERNS = [
  /^(?:СЦЕНА\s*)?(\d+)\s*[.)\-:]\s*(ИНТ|ЭКС|НАТ|ИНТЕРЬЕР|ЭКСТЕРЬЕР)[.\s]+(.+?)(?:\s*[-–—]\s*(ДЕНЬ|НОЧЬ|УТРО|ВЕЧЕР|РАССВЕТ|ЗАКАТ))?$/im,
  /^(\d+)\s*[.)\-:]\s*(.+?)$/m,
  /^СЦЕНА\s*(\d+)/im,
];

// Имя персонажа (говорящего): "ТОМА", "ГАЛЯ (ЗК)", "МУЖ ГАЛИНЫ"
const SPEAKER_PATTERN = /^([А-ЯЁA-Z][А-ЯЁA-Z0-9\s]{1,30})(?:\s*\(([^)]+)\))?\s*$/;

// Ремарка в скобках: "(входит в комнату)"
const PARENTHETICAL_PATTERN = /^\s*\(([^)]+)\)\s*$/;

// Голос за кадром
const VOICEOVER_MARKERS = ['ЗК', 'ГЗК', 'ГЗ', 'V.O.', 'VO', 'O.S.', 'OS'];

// Технические слова (НЕ персонажи)
const EXCLUDE_SPEAKERS = new Set([
  'ТИТР', 'ТИТРЫ', 'НАДПИСЬ', 'СУБТИТР',
  'МУЗЫКА', 'ЗВУК', 'SFX', 'ЗАТЕМНЕНИЕ', 'ЗАТЕМН',
  'ПРОДОЛЖЕНИЕ', 'ПРОДОЛЖ', 'КОНЕЦ', 'THE END',
  'ИНТ', 'ЭКС', 'НАТ', 'ИНТЕРЬЕР', 'ЭКСТЕРЬЕР',
  'СЦЕНА', 'ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР',
  'FADE IN', 'FADE OUT', 'CUT TO', 'DISSOLVE',
  // Заголовки сцен и технические блоки
  'ХРОН', 'ХРОН ОБЩИЙ', 'ХРОНОМЕТРАЖ',
  'ГОРОД', 'ДЕРЕВНЯ', 'СЕЛО', 'ПОСЁЛОК', 'ПОСЕЛОК',
  'ЛОКАЦИИ', 'ЛОКАЦИЯ', 'МЕСТО', 'МЕСТА',
  'АВТОР', 'РЕЖИССЁР', 'РЕЖИССЕР', 'ПРОДЮСЕР', 'ОПЕРАТОР',
  'СЦЕНАРИЙ', 'СЦЕНАРИСТ', 'РЕДАКТОР',
  'МАССОВКА', 'ГРУППОВКА', 'ЭПИЗОДНИКИ',
  'СЕРИЯ', 'ЭПИЗОД', 'ЧАСТЬ', 'АКТ',
]);

// Локации, реквизит и другие НЕ-персонажи (исключаем из описаний)
const EXCLUDE_FROM_DESCRIPTIONS = new Set([
  // Локации
  'САЛОН', 'КВАРТИРА', 'ДОМ', 'КОМНАТА', 'КУХНЯ', 'СПАЛЬНЯ', 'ГОСТИНАЯ',
  'ОФИС', 'КАБИНЕТ', 'КОРИДОР', 'ПОДЪЕЗД', 'ЛЕСТНИЦА', 'ЛИФТ',
  'УЛИЦА', 'ДВОР', 'ПАРК', 'САД', 'ЛЕС', 'ПЛЯЖ', 'МОРЕ',
  'МАГАЗИН', 'РЕСТОРАН', 'КАФЕ', 'БАР', 'КЛУБ', 'ОТЕЛЬ', 'ГОСТИНИЦА',
  'БОЛЬНИЦА', 'ПОЛИКЛИНИКА', 'АПТЕКА', 'ШКОЛА', 'УНИВЕРСИТЕТ',
  'ЦЕРКОВЬ', 'ХРАМ', 'КЛАДБИЩЕ', 'ТЮРЬМА', 'ПОЛИЦИЯ', 'СУД',
  'ВОКЗАЛ', 'АЭРОПОРТ', 'МЕТРО', 'АВТОБУС', 'ТАКСИ', 'МАШИНА',
  'БАЛКОН', 'ТЕРРАСА', 'ВЕРАНДА', 'ЧЕРДАК', 'ПОДВАЛ', 'ГАРАЖ',
  'ГОРОД', 'ДЕРЕВНЯ', 'СЕЛО', 'ПОСЁЛОК', 'ПОСЕЛОК', 'РАЙОН',
  'ПРИХОЖАЯ', 'ВАННАЯ', 'ТУАЛЕТ', 'САНУЗЕЛ', 'ХОЛЛ', 'ФОЙЕ',
  
  // Групповые/абстрактные
  'ЭПИЗОДНИКИ', 'ЭПИЗОД', 'МАССОВКА', 'ТОЛПА', 'ГОСТИ', 'ВСЕ',
  'ГРУППА', 'КОМПАНИЯ', 'СЕМЬЯ', 'РОДСТВЕННИКИ', 'ДРУЗЬЯ',
  'ГРУППОВКА', 'ВТОРОСТЕПЕННЫЕ',
  
  // Технические заголовки сценария
  'ХРОН', 'ХРОН ОБЩИЙ', 'ХРОНОМЕТРАЖ', 'ХРОНОМЕТР',
  'ЛОКАЦИИ', 'ЛОКАЦИЯ', 'ИНТЕРЬЕР', 'ЭКСТЕРЬЕР',
  'АВТОР', 'СЦЕНАРИЙ', 'РЕЖИССЁР', 'РЕЖИССЕР', 'ОПЕРАТОР',
  
  // Реквизит и предметы
  'ОДЕЖДА', 'КОСТЮМ', 'КОСТЮМЫ', 'ПЛАТЬЕ', 'РЕКВИЗИТ',
  'МЕБЕЛЬ', 'СТОЛ', 'СТУЛ', 'КРЕСЛО', 'ДИВАН', 'КРОВАТЬ',
  'ЕДА', 'БЛЮДО', 'БЛЮДА', 'ПОСУДА', 'НАПИТКИ',
  'КУС', 'ПЛОВ', 'БОРЩ',
  'ТЕЛЕФОН', 'КОМПЬЮТЕР', 'ТЕЛЕВИЗОР', 'МАШИНА',
  
  // Время и обстоятельства
  'ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР', 'РАССВЕТ', 'ЗАКАТ',
  'ФЛЕШБЭК', 'ВОСПОМИНАНИЕ', 'СОН', 'МЕЧТА',
]);

// Женские окончания имён
const FEMALE_ENDINGS = ['А', 'Я', 'ИЯ', 'ЬЯ', 'КА', 'ЧКА', 'ШКА'];
const FEMALE_NAMES = new Set([
  'ТОМА', 'ГАЛЯ', 'ГАЛИНА', 'БЭЛЛА', 'БЕЛЛА', 'ШУРОЧКА', 'СВЕТА', 'СВЕТЛАНА',
  'НАДЯ', 'НАДЕЖДА', 'ВАРЯ', 'ВАРВАРА', 'МАША', 'МАРИЯ', 'КАТЯ', 'ЕКАТЕРИНА',
  'ЛЕНА', 'ЕЛЕНА', 'ОЛЯ', 'ОЛЬГА', 'ТАНЯ', 'ТАТЬЯНА', 'НАТАША', 'НАТАЛЬЯ',
  'АНЯ', 'АННА', 'ИРА', 'ИРИНА', 'ЛЮДА', 'ЛЮДМИЛА', 'ЖЕНА', 'МАТЬ', 'ДОЧЬ',
]);
const MALE_NAMES = new Set([
  'ЮСЕФ', 'ИВАН', 'ПЕТР', 'ПЁТР', 'АНДРЕЙ', 'СЕРГЕЙ', 'АЛЕКСЕЙ', 'ДМИТРИЙ',
  'НИКОЛАЙ', 'МИХАИЛ', 'АЛЕКСАНДР', 'САША', 'КОЛЯ', 'МИША', 'ЖЕНЯ',
  'МУЖ', 'ОТЕЦ', 'СЫН', 'БРАТ',
]);

// ═══════════════════════════════════════════════════════════════
// Основные функции парсинга
// ═══════════════════════════════════════════════════════════════

/**
 * Парсит DOCX файл и извлекает текст
 */
export async function parseDocxFile(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Error parsing DOCX:', error);
    throw new Error('Не удалось прочитать DOCX файл');
  }
}

/**
 * Парсит DOC файл (старый формат Word) и извлекает текст
 */
export async function parseDocFile(buffer: Buffer): Promise<string> {
  try {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    return doc.getBody();
  } catch (error) {
    console.error('Error parsing DOC:', error);
    throw new Error('Не удалось прочитать DOC файл');
  }
}

/**
 * Парсит TXT файл
 */
export function parseTxtFile(buffer: Buffer): string {
  // UTF-8 - основная кодировка
  const text = buffer.toString('utf-8');
  
  // Проверяем, что текст читаем (есть кириллица)
  if (text.match(/[А-Яа-яЁё]/)) {
    return text;
  }
  
  // Если нет кириллицы, возможно файл в другой кодировке
  // Возвращаем как есть - пользователь увидит проблему
  console.warn('⚠️ TXT file may not be in UTF-8 encoding. Please save as UTF-8.');
  return text;
}

/**
 * Главная функция парсинга сценария
 */
export async function parseScript(
  fileBuffer: Buffer,
  filename: string
): Promise<ParsedScript> {
  const ext = filename.toLowerCase().split('.').pop();
  
  let rawText: string;
  
  if (ext === 'docx') {
    rawText = await parseDocxFile(fileBuffer);
  } else if (ext === 'doc') {
    rawText = await parseDocFile(fileBuffer);
  } else if (ext === 'txt') {
    rawText = parseTxtFile(fileBuffer);
  } else {
    throw new Error(`Неподдерживаемый формат файла: ${ext}. Используйте .doc, .docx или .txt`);
  }
  
  // Определяем формат сценария
  const format = detectScriptFormat(rawText);
  console.log(`📄 Script format detected: ${format}`);
  
  // Парсим в зависимости от формата
  const scenes = format === 'standard' 
    ? parseStandardFormat(rawText)
    : parseFreeformScript(rawText);
  
  // Извлекаем персонажей из всех диалогов (с описаниями)
  const characters = extractCharactersFromScenes(scenes, rawText);
  
  // Пытаемся извлечь название
  const title = extractTitle(rawText);
  
  console.log(`📊 Parsed script: ${scenes.length} scenes, ${characters.length} characters`);
  for (const char of characters.slice(0, 10)) {
    const descPart = char.description ? ` — ${char.description.substring(0, 40)}${char.description.length > 40 ? '...' : ''}` : '';
    console.log(`   • ${char.name} (${char.dialogueCount} реплик, ${char.gender})${descPart}`);
  }
  
  return {
    title,
    scenes,
    characters,
    rawText,
    format,
  };
}

/**
 * Определяет формат сценария
 */
function detectScriptFormat(text: string): 'standard' | 'freeform' {
  const lines = text.split('\n').slice(0, 100); // Проверяем первые 100 строк
  
  let sceneHeaders = 0;
  let centeredSpeakers = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Проверяем заголовки сцен
    for (const pattern of SCENE_HEADER_PATTERNS) {
      if (pattern.test(trimmed)) {
        sceneHeaders++;
        break;
      }
    }
    
    // Проверяем имена персонажей (обычно центрированы или заглавными)
    if (SPEAKER_PATTERN.test(trimmed) && !EXCLUDE_SPEAKERS.has(trimmed.split(/\s/)[0])) {
      centeredSpeakers++;
    }
  }
  
  // Стандартный формат: есть заголовки сцен И имена персонажей
  if (sceneHeaders >= 2 && centeredSpeakers >= 5) {
    return 'standard';
  }
  
  return 'freeform';
}

/**
 * Парсит сценарий в стандартном формате
 */
function parseStandardFormat(text: string): ScriptScene[] {
  const lines = text.split('\n');
  const scenes: ScriptScene[] = [];
  
  let currentScene: ScriptScene | null = null;
  let currentSpeaker: string | null = null;
  let currentDialogue: ScriptDialogue | null = null;
  let isVoiceover = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed) {
      // Пустая строка - сбрасываем текущего спикера
      if (currentDialogue && currentScene) {
        currentScene.dialogues.push(currentDialogue);
        currentDialogue = null;
      }
      currentSpeaker = null;
      continue;
    }
    
    // Проверяем заголовок сцены
    let isSceneHeader = false;
    for (const pattern of SCENE_HEADER_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        // Сохраняем предыдущую сцену
        if (currentScene) {
          if (currentDialogue) {
            currentScene.dialogues.push(currentDialogue);
          }
          scenes.push(currentScene);
        }
        
        // Создаём новую сцену
        currentScene = {
          sceneNumber: parseInt(match[1]) || scenes.length + 1,
          location: match[3]?.trim() || match[2]?.trim(),
          timeOfDay: match[4]?.trim(),
          dialogues: [],
        };
        
        currentSpeaker = null;
        currentDialogue = null;
        isSceneHeader = true;
        break;
      }
    }
    if (isSceneHeader) continue;
    
    // Проверяем имя персонажа
    const speakerMatch = trimmed.match(SPEAKER_PATTERN);
    if (speakerMatch && !EXCLUDE_SPEAKERS.has(speakerMatch[1].trim().split(/\s/)[0])) {
      const potentialSpeaker = speakerMatch[1].trim();
      const modifier = speakerMatch[2]?.trim().toUpperCase();
      
      // Проверяем, что это похоже на имя (а не просто слово заглавными)
      if (potentialSpeaker.length >= 2 && potentialSpeaker.length <= 30) {
        // Сохраняем предыдущий диалог
        if (currentDialogue && currentScene) {
          currentScene.dialogues.push(currentDialogue);
        }
        
        currentSpeaker = potentialSpeaker;
        isVoiceover = modifier ? VOICEOVER_MARKERS.includes(modifier) : false;
        currentDialogue = null;
        
        // Если нет текущей сцены, создаём "нулевую"
        if (!currentScene) {
          currentScene = {
            sceneNumber: 0,
            dialogues: [],
          };
        }
        continue;
      }
    }
    
    // Проверяем ремарку
    if (PARENTHETICAL_PATTERN.test(trimmed)) {
      // Ремарка - добавляем к описанию сцены
      if (currentScene && !currentScene.description) {
        currentScene.description = trimmed.replace(/[()]/g, '').trim();
      }
      continue;
    }
    
    // Это текст диалога
    if (currentSpeaker && currentScene) {
      if (!currentDialogue) {
        currentDialogue = {
          speaker: currentSpeaker,
          text: trimmed,
          isVoiceover,
          lineNumber: i + 1,
        };
      } else {
        // Продолжение диалога
        currentDialogue.text += ' ' + trimmed;
      }
    }
  }
  
  // Сохраняем последнюю сцену
  if (currentScene) {
    if (currentDialogue) {
      currentScene.dialogues.push(currentDialogue);
    }
    scenes.push(currentScene);
  }
  
  return scenes;
}

/**
 * Парсит свободный формат сценария (без чёткой структуры)
 */
function parseFreeformScript(text: string): ScriptScene[] {
  const lines = text.split('\n');
  const dialogues: ScriptDialogue[] = [];
  
  // Паттерн для диалога: "ПЕРСОНАЖ: текст" или "ПЕРСОНАЖ\nтекст"
  const dialoguePattern = /^([А-ЯЁA-Z][А-ЯЁA-Z\s]{1,25})(?:\s*[:：]\s*|\s*$)/;
  
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed) {
      // Сохраняем накопленный диалог
      if (currentSpeaker && currentText.length > 0) {
        dialogues.push({
          speaker: currentSpeaker,
          text: currentText.join(' '),
          lineNumber: i + 1,
        });
      }
      currentSpeaker = null;
      currentText = [];
      continue;
    }
    
    const match = trimmed.match(dialoguePattern);
    if (match) {
      const potentialSpeaker = match[1].trim();
      
      // Проверяем, что это не технический термин
      if (!EXCLUDE_SPEAKERS.has(potentialSpeaker.split(/\s/)[0])) {
        // Сохраняем предыдущий диалог
        if (currentSpeaker && currentText.length > 0) {
          dialogues.push({
            speaker: currentSpeaker,
            text: currentText.join(' '),
            lineNumber: i + 1,
          });
        }
        
        currentSpeaker = potentialSpeaker;
        currentText = [];
        
        // Если есть текст после двоеточия на той же строке
        const afterColon = trimmed.replace(match[0], '').trim();
        if (afterColon) {
          currentText.push(afterColon);
        }
        continue;
      }
    }
    
    // Продолжение текста
    if (currentSpeaker) {
      currentText.push(trimmed);
    }
  }
  
  // Сохраняем последний диалог
  if (currentSpeaker && currentText.length > 0) {
    dialogues.push({
      speaker: currentSpeaker,
      text: currentText.join(' '),
    });
  }
  
  // Создаём одну сцену со всеми диалогами
  return [{
    sceneNumber: 1,
    dialogues,
  }];
}

/**
 * Извлекает персонажей из сцен
 */
function extractCharactersFromScenes(scenes: ScriptScene[], rawText: string): ScriptCharacter[] {
  const characterMap = new Map<string, ScriptCharacter>();
  
  // Сначала ищем описания в списке действующих лиц и в тексте
  const descriptions = extractCharacterDescriptions(rawText);
  
  // ═══════════════════════════════════════════════════════════════
  // 1. СНАЧАЛА добавляем персонажей из описаний (даже если нет диалогов)
  // Это критически важно для сценариев где диалоги не парсятся
  // ═══════════════════════════════════════════════════════════════
  for (const [name, desc] of descriptions) {
    // Пропускаем нормализованные дубли (добавленные через normalizeCharacterName)
    const normalized = normalizeCharacterName(name);
    if (name !== name.toUpperCase()) continue; // Пропускаем если не заглавными
    
    if (!characterMap.has(normalized) && isValidCharacterName(name)) {
      characterMap.set(normalized, {
        name: name.toUpperCase(),
        normalizedName: normalized,
        dialogueCount: 1, // Минимум 1, чтобы персонаж попал в список
        firstAppearance: 0,
        gender: inferGender(name),
        variants: [name.toUpperCase()],
        description: desc,
      });
    }
  }
  
  console.log(`📋 Added ${characterMap.size} characters from descriptions`);
  
  // ═══════════════════════════════════════════════════════════════
  // 2. Теперь добавляем персонажей из диалогов (если есть)
  // ═══════════════════════════════════════════════════════════════
  for (const scene of scenes) {
    for (const dialogue of scene.dialogues) {
      const normalized = normalizeCharacterName(dialogue.speaker);
      
      if (!characterMap.has(normalized)) {
        characterMap.set(normalized, {
          name: dialogue.speaker.toUpperCase(),
          normalizedName: normalized,
          dialogueCount: 0,
          firstAppearance: scene.sceneNumber,
          gender: inferGender(dialogue.speaker),
          variants: [dialogue.speaker.toUpperCase()],
          description: descriptions.get(normalized) || descriptions.get(dialogue.speaker.toUpperCase()),
        });
      }
      
      const char = characterMap.get(normalized)!;
      char.dialogueCount++;
      
      // Добавляем вариант имени если отличается
      const upperSpeaker = dialogue.speaker.toUpperCase();
      if (!char.variants.includes(upperSpeaker)) {
        char.variants.push(upperSpeaker);
      }
    }
  }
  
  // Фильтруем невалидные персонажи (ХРОН, ГОРОД, ДЕРЕВНЯ и т.д.)
  const validCharacters = Array.from(characterMap.values())
    .filter(c => isValidCharacterName(c.name));
  
  console.log(`📋 After filtering: ${validCharacters.length} valid characters`);
  
  // Сортируем по количеству реплик (главные персонажи первые)
  return validCharacters.sort((a, b) => b.dialogueCount - a.dialogueCount);
}

/**
 * Проверяет, является ли строка именем персонажа (а не локацией/реквизитом)
 */
function isValidCharacterName(name: string): boolean {
  const upper = name.toUpperCase().trim();
  
  // Исключаем технические слова
  if (EXCLUDE_SPEAKERS.has(upper)) return false;
  if (EXCLUDE_SPEAKERS.has(upper.split(/\s/)[0])) return false;
  
  // Исключаем локации и реквизит
  if (EXCLUDE_FROM_DESCRIPTIONS.has(upper)) return false;
  
  // Исключаем составные локации: "КВАРТИРА ЮСЕФА", "САЛОН КРАСОТЫ"
  const firstWord = upper.split(/\s/)[0];
  if (EXCLUDE_FROM_DESCRIPTIONS.has(firstWord)) return false;
  
  // Исключаем если есть слова-маркеры локаций
  if (/(?:КВАРТИРА|САЛОН|КОМНАТА|ДОМ|ОФИС|КЛУБ|РЕСТОРАН)\s+/i.test(upper)) return false;
  
  // Исключаем если это описание вещей (ОДЕЖДА ЖЁН, КУС)
  if (/^(?:ОДЕЖДА|КОСТЮМ|ЕДА|БЛЮД|ПОСУДА|РЕКВИЗИТ)/i.test(upper)) return false;
  
  // Имя должно быть разумной длины
  if (upper.length < 2 || upper.length > 25) return false;
  
  return true;
}

/**
 * Извлекает описания персонажей из текста сценария
 * Ищет в:
 * 1. Списке действующих лиц / ПЕРСОНАЖИ
 * 2. Первых появлениях персонажей в ремарках
 * 3. Скобках после имени персонажа
 */
function extractCharacterDescriptions(text: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  const lines = text.split('\n');
  
  // ═══════════════════════════════════════════════════════════════
  // 0. УНИВЕРСАЛЬНЫЙ ПОИСК: "Имя (возраст) – описание" в любом месте
  // Формат: "Елена (37) – состоятельная женщина, замужем..."
  // ═══════════════════════════════════════════════════════════════
  {
    // Паттерн для "Имя (возраст) – описание" или "Имя Отчество (возраст) – описание"
    const universalPattern = /^([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s*\((\d{1,3})\)\s*[-–—]\s*(.{10,500})$/gm;
    let match;
    
    while ((match = universalPattern.exec(text)) !== null) {
      const name = match[1].trim().toUpperCase();
      const age = match[2];
      const descText = match[3].trim();
      
      // Проверяем что это похоже на описание персонажа
      if (isValidCharacterName(name) && descText.length > 10) {
        const desc = `${age} лет, ${descText}`;
        if (!descriptions.has(name)) {
          descriptions.set(name, desc);
          descriptions.set(normalizeCharacterName(name), desc);
          console.log(`   ✅ Found character: ${name} (${age}) — ${descText.substring(0, 50)}...`);
        }
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 0.5 ГРУППОВКИ: "Групповка: Имя (возраст) – описание"
  // Формат: "Вика (42) –подруга Елены..."
  // ═══════════════════════════════════════════════════════════════
  {
    // Ищем секции "Групповка:" и парсим персонажей после них
    const groupPattern = /(?:Групповка|Эпизодники|Второстепенные)[:\s]*\n([\s\S]{0,2000}?)(?=\n\n|\nЛокации|\nИнтерьер|\nЭкстерьер|$)/gi;
    let groupMatch;
    
    while ((groupMatch = groupPattern.exec(text)) !== null) {
      const groupBlock = groupMatch[1];
      
      // Ищем персонажей внутри группы
      const charInGroupPattern = /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s*\((\d{1,3})\)\s*[-–—]?\s*(.{5,200})/g;
      let charMatch;
      
      while ((charMatch = charInGroupPattern.exec(groupBlock)) !== null) {
        const name = charMatch[1].trim().toUpperCase();
        const age = charMatch[2];
        const descText = charMatch[3].trim();
        
        if (isValidCharacterName(name) && !descriptions.has(name)) {
          const desc = `${age} лет, ${descText}`;
          descriptions.set(name, desc);
          descriptions.set(normalizeCharacterName(name), desc);
          console.log(`   ✅ Found in group: ${name} (${age}) — ${descText.substring(0, 40)}...`);
        }
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 1. Ищем блок "ДЕЙСТВУЮЩИЕ ЛИЦА" / "ПЕРСОНАЖИ" / "ГЕРОИ"
  // ═══════════════════════════════════════════════════════════════
  const castBlockPattern = /(?:ДЕЙСТВУЮЩИЕ ЛИЦА|ПЕРСОНАЖИ|ГЕРОИ|CAST|CHARACTERS|СЦЕНАРИЙ)[:\s]*\n/i;
  const castMatch = text.match(castBlockPattern);
  
  if (castMatch) {
    const startIndex = text.indexOf(castMatch[0]) + castMatch[0].length;
    const endIndex = Math.min(startIndex + 5000, text.length);
    const castBlock = text.slice(startIndex, endIndex);
    
    // Паттерн 1: "ГАЛИНА (50) - описание" или "ГАЛИНА — описание" (ВСЕ ЗАГЛАВНЫМИ)
    const characterLinePattern1 = /^([А-ЯЁA-Z][А-ЯЁA-Z\s]{1,25})(?:\s*\((\d+)\))?\s*[-–—:]\s*(.+)$/gm;
    let match;
    
    while ((match = characterLinePattern1.exec(castBlock)) !== null) {
      const name = match[1].trim().toUpperCase();
      const age = match[2];
      let desc = match[3].trim();
      
      if (age) {
        desc = `${age} лет, ${desc}`;
      }
      
      if (desc && desc.length > 3 && isValidCharacterName(name)) {
        if (!descriptions.has(name)) {
          descriptions.set(name, desc);
          descriptions.set(normalizeCharacterName(name), desc);
        }
      }
    }
    
    // Паттерн 2: "Галина – 27 лет, описание" (возраст после тире)
    const characterLinePattern2 = /^([А-ЯЁа-яёA-Za-z][а-яёa-z]{2,15})\s*[-–—]\s*(\d{1,3})\s*(?:лет|год)[,\s]+(.+)$/gm;
    
    while ((match = characterLinePattern2.exec(castBlock)) !== null) {
      const name = match[1].trim().toUpperCase();
      const age = match[2];
      const restDesc = match[3].trim();
      
      if (isValidCharacterName(name) && restDesc.length > 5) {
        const desc = `${age} лет, ${restDesc}`;
        if (!descriptions.has(name)) {
          descriptions.set(name, desc);
          descriptions.set(normalizeCharacterName(name), desc);
        }
      }
    }
    
    // Паттерн 3: "Юсеф – араб, черноволосый..." (без возраста)
    const characterLinePattern3 = /^([А-ЯЁа-яёA-Za-z][а-яёa-z]{2,15})\s*[-–—]\s*([а-яёa-z].{10,200})$/gm;
    
    while ((match = characterLinePattern3.exec(castBlock)) !== null) {
      const name = match[1].trim().toUpperCase();
      const desc = match[2].trim();
      
      const looksLikeDescription = /(?:лет|женщина|мужчина|девушка|парень|молодой|молодая|старый|старая|полн|худ|высок|невысок|красив|привлекательн|блондин|брюнет|рыж|смугл|араб|стройн|крупн)/i.test(desc);
      
      if (isValidCharacterName(name) && looksLikeDescription && !descriptions.has(name)) {
        descriptions.set(name, desc);
        descriptions.set(normalizeCharacterName(name), desc);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 1.5 Ищем нумерованные эпизодники: "2. Менеджер – 50 лет, описание"
  // ═══════════════════════════════════════════════════════════════
  const numberedPattern = /^\d+\.\s*([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\s]{1,20})\s*[-–—]\s*(.{15,300})$/gm;
  let numberedMatch;
  
  while ((numberedMatch = numberedPattern.exec(text)) !== null) {
    let name = numberedMatch[1].trim();
    let desc = numberedMatch[2].trim();
    
    // Если несколько имён через запятую - берём первое
    if (name.includes(',')) {
      const names = name.split(',').map(n => n.trim().toUpperCase());
      // Для групповых описаний - добавляем каждому
      for (const n of names) {
        if (isValidCharacterName(n) && !descriptions.has(n)) {
          descriptions.set(n, desc);
          descriptions.set(normalizeCharacterName(n), desc);
        }
      }
    } else {
      name = name.toUpperCase();
      if (isValidCharacterName(name) && !descriptions.has(name)) {
        descriptions.set(name, desc);
        descriptions.set(normalizeCharacterName(name), desc);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 2. Ищем описания при первом появлении в ремарках
  // Паттерн: "ГАЛИНА (50, полная женщина) входит" или "входит ГАЛИНА, 50 лет, полная"
  // ═══════════════════════════════════════════════════════════════
  const firstAppearancePattern = /([А-ЯЁA-Z][А-ЯЁA-Z]{1,15})\s*\((\d{1,3}(?:\s*[-–—,]\s*[^)]+)?)\)/g;
  let appearMatch;
  
  while ((appearMatch = firstAppearancePattern.exec(text)) !== null) {
    const name = appearMatch[1].trim().toUpperCase();
    const descInParens = appearMatch[2].trim();
    
    // Пропускаем технические термины
    if (!isValidCharacterName(name)) continue;
    
    // Проверяем, что это не просто ЗК/ПРОДОЛЖ
    if (descInParens.length > 2 && !VOICEOVER_MARKERS.includes(descInParens.toUpperCase())) {
      // Если описание ещё не найдено или это более подробное
      const existing = descriptions.get(name);
      if (!existing || descInParens.length > existing.length) {
        // Форматируем описание
        let formattedDesc = descInParens;
        
        // Парсим возраст и описание
        const ageMatch = descInParens.match(/^(\d{1,3})(?:\s*[-–—,лет\s]+(.*))?$/);
        if (ageMatch) {
          const age = ageMatch[1];
          const restDesc = ageMatch[2]?.trim();
          formattedDesc = restDesc ? `${age} лет, ${restDesc}` : `${age} лет`;
        }
        
        descriptions.set(name, formattedDesc);
        descriptions.set(normalizeCharacterName(name), formattedDesc);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 3. Ищем развёрнутые описания в ремарках
  // Паттерн: "В комнату входит ГАЛИНА — полная женщина лет пятидесяти"
  // ═══════════════════════════════════════════════════════════════
  const narrativePattern = /(?:входит|появляется|сидит|стоит)\s+([А-ЯЁA-Z][А-ЯЁA-Z]{1,15})(?:\s*[-–—,]\s*)([^.!?\n]{10,80})/gi;
  let narrativeMatch;
  
  while ((narrativeMatch = narrativePattern.exec(text)) !== null) {
    const name = narrativeMatch[1].trim().toUpperCase();
    const desc = narrativeMatch[2].trim();
    
    if (!isValidCharacterName(name)) continue;
    
    // Добавляем только если это похоже на описание внешности
    const looksLikeDescription = /(?:лет|женщина|мужчина|девушка|парень|молодой|молодая|старый|старая|полн|худ|высок|невысок|красив|привлекательн)/i.test(desc);
    
    if (looksLikeDescription && !descriptions.has(name)) {
      descriptions.set(name, desc);
      descriptions.set(normalizeCharacterName(name), desc);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 4. Ищем описания в строках типа "ГАЛИНА, лет 50, владелица салона"
  // ═══════════════════════════════════════════════════════════════
  for (let i = 0; i < Math.min(lines.length, 200); i++) {
    const line = lines[i].trim();
    
    // Паттерн: "ГАЛИНА, лет 50," или "ГАЛИНА (50 лет)"
    const simplePattern = /^([А-ЯЁA-Z][А-ЯЁA-Z]{1,15})(?:\s*,\s*|\s+)(?:лет\s*)?(\d{1,3})(?:\s*лет)?(?:\s*,\s*|\s+)(.+)$/;
    const simpleMatch = line.match(simplePattern);
    
    if (simpleMatch) {
      const name = simpleMatch[1].toUpperCase();
      const age = simpleMatch[2];
      const rest = simpleMatch[3].trim();
      
      if (isValidCharacterName(name) && rest.length > 3) {
        const desc = `${age} лет, ${rest}`;
        if (!descriptions.has(name)) {
          descriptions.set(name, desc);
          descriptions.set(normalizeCharacterName(name), desc);
        }
      }
    }
  }
  
  console.log(`📝 Extracted ${descriptions.size} character descriptions`);
  for (const [name, desc] of descriptions) {
    console.log(`   • ${name}: ${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}`);
  }
  
  return descriptions;
}

/**
 * Нормализует имя персонажа (убирает варианты)
 */
function normalizeCharacterName(name: string): string {
  let normalized = name.toUpperCase().trim();
  
  // Убираем модификаторы в скобках
  normalized = normalized.replace(/\s*\([^)]+\)\s*/g, '').trim();
  
  // Убираем числа в конце
  normalized = normalized.replace(/\s*\d+\s*$/, '').trim();
  
  // Нормализуем известные варианты
  // ВАЖНО: Короткие формы предпочтительнее для монтажных листов
  const VARIANTS: Record<string, string> = {
    // Женские имена
    'ГАЛИНА': 'ГАЛЯ',
    'ГАЛОЧКА': 'ГАЛЯ',
    'ТАТЬЯНА': 'ТАНЯ',
    'ТАНЮША': 'ТАНЯ',
    'ТАНЬКА': 'ТАНЯ',
    'АЛЕКСАНДРА': 'ШУРА',
    'ШУРОЧКА': 'ШУРОЧКА', // Оставляем как есть — это персонаж
    'СВЕТЛАНА': 'СВЕТА',
    'СВЕТОЧКА': 'СВЕТА',
    'СВЕТИК': 'СВЕТИК', // Оставляем — это персонаж
    'НАТАЛЬЯ': 'НАТАША',
    'НАТАШКА': 'НАТАША',
    'ЕКАТЕРИНА': 'КАТЯ',
    'КАТЮША': 'КАТЯ',
    'ЕЛЕНА': 'ЛЕНА',
    'ЛЕНОЧКА': 'ЛЕНА',
    'ОЛЬГА': 'ОЛЯ',
    'ОЛЕНЬКА': 'ОЛЯ',
    'ИРИНА': 'ИРА',
    'ИРОЧКА': 'ИРА',
    'ЛЮДМИЛА': 'ЛЮДАСЯ', // Специфично для "Любовь и прочие глупости"
    'ЛЮДОЧКА': 'ЛЮДАСЯ',
    'МАРИЯ': 'МАША',
    'МАШЕНЬКА': 'МАША',
    'НАДЕЖДА': 'НАДЯ',
    'НАДЮША': 'НАДЯ',
    'АННА': 'АНЯ',
    'АНЕЧКА': 'АНЯ',
    'ВАРВАРА': 'ВАРЯ',
    'ВАРЕНЬКА': 'ВАРЯ',
    'ТАМАРА': 'ТОМА',
    'ТОМОЧКА': 'ТОМА',
    'ВАЛЕНТИНА': 'ВАЛЯ',
    'ЗИНАИДА': 'ЗИНА',
    'ЛАРИСА': 'ЛАРА',
    'ПОЛИНА': 'ПОЛЯ',
    'ЮЛИЯ': 'ЮЛЯ',
    'ДАРЬЯ': 'ДАША',
    'АНАСТАСИЯ': 'НАСТЯ',
    'ЕВГЕНИЯ': 'ЖЕНЯ',
    // Мужские имена
    'АЛЕКСАНДР': 'САША',
    'ДМИТРИЙ': 'ДИМА',
    'МИХАИЛ': 'МИША',
    'НИКОЛАЙ': 'КОЛЯ',
    'ВЛАДИМИР': 'ВОВА',
    'СЕРГЕЙ': 'СЕРЁЖА',
    'АНДРЕЙ': 'АНДРЮША',
    'АЛЕКСЕЙ': 'ЛЁША',
    'ИВАН': 'ВАНЯ',
    'ПЁТР': 'ПЕТЯ',
    'ВИКТОР': 'ВИТЯ',
    'ЮРИЙ': 'ЮРА',
    'БОРИС': 'БОРЯ',
    'ПАВЕЛ': 'ПАША',
    'ВАСИЛИЙ': 'ВАСЯ',
    'ЕВГЕНИЙ': 'ЖЕНЯ',
    // Не меняем специфичные имена
    'ИОСИФ': 'ИОСИФ',
    'ЮСЕФ': 'ЮСЕФ',
    'БЭЛЛА': 'БЭЛЛА',
    'СЮЗАННА': 'СЮЗАННА',
    'ТОМА': 'ТОМА',
    'ЛЮДАСЯ': 'ЛЮДАСЯ',
  };
  
  return VARIANTS[normalized] || normalized;
}

/**
 * Определяет пол персонажа по имени
 */
function inferGender(name: string): 'male' | 'female' | 'unknown' {
  const upper = name.toUpperCase().trim();
  
  if (FEMALE_NAMES.has(upper)) return 'female';
  if (MALE_NAMES.has(upper)) return 'male';
  
  // Проверяем окончания
  for (const ending of FEMALE_ENDINGS) {
    if (upper.endsWith(ending)) return 'female';
  }
  
  // Проверяем составные имена (МУЖ ГАЛИНЫ -> male)
  if (upper.startsWith('МУЖ ')) return 'male';
  if (upper.startsWith('ЖЕНА ')) return 'female';
  if (upper.startsWith('СЕСТРА ')) return 'female';
  if (upper.startsWith('БРАТ ')) return 'male';
  
  return 'unknown';
}

/**
 * Извлекает название из текста
 */
function extractTitle(text: string): string | undefined {
  const lines = text.split('\n').slice(0, 20);
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Пропускаем пустые и короткие
    if (!trimmed || trimmed.length < 3) continue;
    
    // Ищем строку в кавычках как название
    const quotedMatch = trimmed.match(/[«""]([^»""]+)[»""]/);
    if (quotedMatch) {
      return quotedMatch[1].trim();
    }
    
    // Ищем строку заглавными как название (но не заголовок сцены)
    if (trimmed === trimmed.toUpperCase() && !trimmed.includes('ИНТ') && !trimmed.includes('СЦЕНА')) {
      if (trimmed.length >= 5 && trimmed.length <= 100) {
        return trimmed;
      }
    }
  }
  
  return undefined;
}

/**
 * Форматирует персонажей для промпта Gemini
 */
export function formatCharactersForGeminiPrompt(characters: ScriptCharacter[]): string {
  if (!characters || characters.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('📋 ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ (ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ ЭТИ ИМЕНА!):');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Сортируем по важности (количеству реплик)
  const sorted = [...characters].sort((a, b) => b.dialogueCount - a.dialogueCount);
  
  // Главные персонажи (много реплик)
  const main = sorted.filter(c => c.dialogueCount >= 5);
  const secondary = sorted.filter(c => c.dialogueCount >= 2 && c.dialogueCount < 5);
  const minor = sorted.filter(c => c.dialogueCount === 1);
  
  if (main.length > 0) {
    lines.push('🌟 ГЛАВНЫЕ ПЕРСОНАЖИ (запомни их внешность!):');
    for (const char of main) {
      const genderIcon = char.gender === 'female' ? '♀' : char.gender === 'male' ? '♂' : '?';
      let line = `   • ${char.name} ${genderIcon}`;
      if (char.description) {
        line += ` — ${char.description}`;
      }
      if (char.variants.length > 1) {
        line += ` [также: ${char.variants.slice(1).join(', ')}]`;
      }
      lines.push(line);
    }
    lines.push('');
  }
  
  if (secondary.length > 0) {
    lines.push('👤 ВТОРОСТЕПЕННЫЕ ПЕРСОНАЖИ:');
    for (const char of secondary) {
      const genderIcon = char.gender === 'female' ? '♀' : char.gender === 'male' ? '♂' : '?';
      let line = `   • ${char.name} ${genderIcon}`;
      if (char.description) {
        line += ` — ${char.description}`;
      }
      lines.push(line);
    }
    lines.push('');
  }
  
  if (minor.length > 0 && minor.length <= 10) {
    lines.push('👥 ЭПИЗОДИЧЕСКИЕ:');
    for (const char of minor) {
      let line = `   • ${char.name}`;
      if (char.description) {
        line += ` — ${char.description}`;
      }
      lines.push(line);
    }
    lines.push('');
  }
  
  lines.push('');
  lines.push('⚠️  КРИТИЧЕСКИ ВАЖНО ДЛЯ ИДЕНТИФИКАЦИИ:');
  lines.push('   1. ВСЕГДА используй имена персонажей из списка выше!');
  lines.push('   2. НЕ пиши "ЖЕНЩИНА", "МУЖЧИНА", "ДЕВУШКА" — определи конкретного персонажа!');
  lines.push('   3. Сопоставляй внешность на видео с описаниями персонажей.');
  lines.push('   4. Если видишь женщину 50 лет — это скорее всего ГАЛИНА.');
  lines.push('   5. Если видишь мужчину-араба — это ЮСЕФ.');
  lines.push('   6. Молодые девушки — сопоставь с БЭЛЛА, ТОМА, ШУРОЧКА по возрасту/внешности.');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

