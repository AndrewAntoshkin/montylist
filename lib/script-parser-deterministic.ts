/**
 * Детерминированный парсер сценария V5
 * 
 * Парсит DOCX/DOC/TXT сценарии БЕЗ использования LLM (Gemini).
 * Использует паттерны для определения:
 * - Персонажей (имена в верхнем регистре перед репликами)
 * - Реплик (текст после имени персонажа)
 * - Описаний персонажей (ремарки в скобках)
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════════════════

export interface ScriptCharacter {
  name: string;
  variants: string[];
  dialogueCount: number;
  firstAppearance: number;
  description?: string;
  attributes?: CharacterAttributes;
}

export interface CharacterAttributes {
  gender?: 'M' | 'F' | 'unknown';
  ageRange?: string;
  hairColor?: string;
  distinctiveFeatures?: string[];
  clothing?: string[];
}

export interface ScriptLine {
  lineIndex: number;
  character: string;
  text: string;
  isOffscreen?: boolean;  // ЗК
  isVoiceover?: boolean;  // ГЗК
}

export interface ScriptScene {
  sceneNumber: string;        // "9.19"
  location: string;           // "ИНТ. ДОМ ЮСЕФА. ЗАЛ."
  timeOfDay?: string;         // "ВЕЧЕР", "ДЕНЬ", "НОЧЬ"
  characters: string[];       // ["ЛЕНА", "ВАЛЯ", "ГАЛИНА"]
  startLineIndex: number;
  endLineIndex?: number;
}

export interface ParsedScript {
  title: string;
  characters: ScriptCharacter[];
  lines: ScriptLine[];
  scenes: ScriptScene[];      // НОВОЕ: список сцен с персонажами
  rawText: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ДЛЯ ПАРСИНГА
// ═══════════════════════════════════════════════════════════════════════════

// УЛУЧШЕННЫЙ паттерн: ИМЯ ПЕРСОНАЖА (гибкий, работает с разными форматами)
// Поддерживает:
// - Заглавные: "ГАЛИНА"
// - Смешанный регистр: "Галина"
// - С двоеточием: "Галина:"
// - С тире: "Галина -"
// - С ремаркой: "ГАЛИНА (за кадром)"
const CHARACTER_NAME_PATTERN = /^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z\s\-]{1,50})(\s*[:\-]?\s*(\(.*?\))?)?\s*$/;

// Паттерн: ремарка типа "(за кадром)" или "(голос за кадром)"
const OFFSCREEN_PATTERN = /\(\s*(за\s*кадром|з\.?к\.?|голос\s*за\s*кадром|г\.?з\.?к\.?|off|v\.?o\.?)\s*\)/i;
const VOICEOVER_PATTERN = /\(\s*(голос\s*за\s*кадром|г\.?з\.?к\.?|v\.?o\.?|voice\s*over)\s*\)/i;

// Паттерн: описание персонажа в ремарке
const CHARACTER_DESCRIPTION_PATTERN = /\(\s*([^)]+)\s*\)/g;

// Игнорируемые "персонажи" (не настоящие персонажи)
const IGNORED_NAMES = new Set([
  'ИНТЕРЬЕР', 'ЭКСТЕРЬЕР', 'ИНТ', 'ЭКТ', 'INT', 'EXT',
  'ТИТР', 'ТИТРЫ', 'СЦЕНА', 'КАДР', 'ПЕРЕХОД', 'ЗАТЕМНЕНИЕ',
  'МУЗЫКА', 'ЗВУК', 'ФОН', 'КОНЕЦ', 'НАЧАЛО', 'ПРОДОЛЖЕНИЕ',
  'FLASHBACK', 'ФЛЭШБЕК', 'ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР',
]);

// NAME_VARIANTS УДАЛЁН — имена берём КАК ЕСТЬ из сценария
// Если в сценарии персонаж называется ГАЛЯ — значит ГАЛЯ
// Если ГАЛИНА — значит ГАЛИНА
// Варианты определяются автоматически из самого сценария

// ═══════════════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Парсит текст сценария и извлекает персонажей и реплики
 */
export function parseScriptText(text: string): ParsedScript {
  const lines = text.split('\n');
  const characters = new Map<string, ScriptCharacter>();
  const scriptLines: ScriptLine[] = [];
  const scenes: ScriptScene[] = [];
  
  let currentCharacter: string | null = null;
  let currentIsOffscreen = false;
  let currentIsVoiceover = false;
  let lineIndex = 0;
  let currentScene: ScriptScene | null = null;
  
  // Паттерн заголовка сцены: "9.19. ИНТ. ДОМ ЮСЕФА. ЗАЛ. ВЕЧЕР."
  const SCENE_HEADER_PATTERN = /^(\d+\.\d+\.?)\s*(ИНТ|ЭКТ|INT|EXT|ПАВ)\.?\s*(.+?)\.?\s*(ДЕНЬ|НОЧЬ|УТРО|ВЕЧЕР)?\.?\s*$/i;
  
  // СЕМАНТИЧЕСКИЙ ПАРСИНГ: Определяем тип строки по контексту
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
    const prevLine = i > 0 ? lines[i - 1].trim() : '';
    
    // Проверяем заголовок сцены
    const sceneMatch = line.match(SCENE_HEADER_PATTERN);
    if (sceneMatch) {
      // Закрываем предыдущую сцену
      if (currentScene) {
        currentScene.endLineIndex = lineIndex - 1;
      }
      
      // Создаём новую сцену
      currentScene = {
        sceneNumber: sceneMatch[1],
        location: `${sceneMatch[2]}. ${sceneMatch[3]}`.trim(),
        timeOfDay: sceneMatch[4]?.toUpperCase(),
        characters: [],
        startLineIndex: lineIndex,
      };
      
      // Следующая строка может содержать список персонажей сцены
      // Формат: "Лена, Лариса, Валя, Зина, Света, Галина"
      if (nextLine && !nextLine.match(SCENE_HEADER_PATTERN) && !nextLine.match(CHARACTER_NAME_PATTERN)) {
        // Ищем имена через запятую
        const potentialCharacters = nextLine.split(/[,;]/);
        const sceneCharacters: string[] = [];
        
        for (const name of potentialCharacters) {
          const cleanName = name.trim().replace(/\d+\s*/g, '').trim(); // Убираем "3 девочки"
          if (cleanName.length >= 2 && cleanName.length <= 20 && /^[А-ЯЁа-яё]/.test(cleanName)) {
            sceneCharacters.push(normalizeCharacterName(cleanName));
          }
        }
        
        if (sceneCharacters.length > 0) {
          currentScene.characters = sceneCharacters;
        }
      }
      
      scenes.push(currentScene);
      continue;
    }
    
    if (!line) continue;
    
    // Проверяем, это имя персонажа?
    // УЛУЧШЕНО: Проверяем несколько паттернов для гибкости
    const nameMatch = line.match(CHARACTER_NAME_PATTERN);
    const isPotentialName = nameMatch && 
      // Имя должно начинаться с заглавной буквы
      /^[А-ЯЁA-Z]/.test(nameMatch[1].trim()) &&
      // И не быть слишком длинным (вероятно, это реплика)
      nameMatch[1].trim().length < 50 &&
      // И не быть в списке игнорируемых
      !IGNORED_NAMES.has(nameMatch[1].trim().toUpperCase());
    
    if (isPotentialName) {
      const rawName = nameMatch[1].trim();
      const remark = nameMatch[2] || '';
      
      // Проверяем, не игнорируемое ли это слово
      if (IGNORED_NAMES.has(rawName.toUpperCase())) {
        currentCharacter = null;
        continue;
      }
      
      currentCharacter = normalizeCharacterName(rawName);
      currentIsOffscreen = OFFSCREEN_PATTERN.test(remark);
      currentIsVoiceover = VOICEOVER_PATTERN.test(remark);
      
      // УЛУЧШЕНО: Ищем описание в следующей строке (если это ремарка в скобках)
      let description = extractDescription(remark);
      if (!description && nextLine.startsWith('(') && nextLine.endsWith(')')) {
        // Описание в отдельной строке после имени
        description = extractDescription(`(${nextLine.slice(1, -1)})`);
        if (description) {
          i++; // Пропускаем строку с описанием
        }
      }
      
      // Добавляем/обновляем персонажа
      if (!characters.has(currentCharacter)) {
        // УЛУЧШЕНО: Извлекаем структурированные атрибуты из описания
        const attributes = description ? extractCharacterAttributes(description) : undefined;
        
        characters.set(currentCharacter, {
          name: currentCharacter,
          variants: getNameVariants(currentCharacter),
          dialogueCount: 0,
          firstAppearance: lineIndex,
          description: description,
          attributes: attributes,
        });
      } else {
        // Обновляем описание и атрибуты, если их ещё нет
        const char = characters.get(currentCharacter);
        if (char) {
          if (!char.description && description) {
            char.description = description;
            char.attributes = extractCharacterAttributes(description);
          } else if (description && !char.attributes) {
            // Обновляем атрибуты, если описание уже было, но атрибутов нет
            char.attributes = extractCharacterAttributes(description);
          }
        }
      }
      
      continue;
    }
    
    // УЛУЧШЕНО: Ищем список персонажей в начале сценария
    // Паттерн: "ПЕРСОНАЖИ:" или "CHARACTERS:" или "ДЕЙСТВУЮЩИЕ ЛИЦА:"
    if (i < 50 && /^(персонаж|character|действующ|актёр)/i.test(line) && line.endsWith(':')) {
      // Следующие строки могут быть списком персонажей с описаниями
      for (let j = i + 1; j < Math.min(i + 100, lines.length); j++) {
        const charLine = lines[j].trim();
        if (!charLine || charLine.match(CHARACTER_NAME_PATTERN)) break;
        
        // Паттерн: "Имя - описание" или "Имя: описание"
        const charDescMatch = charLine.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z\s\-]{1,50})\s*[:\-]\s*(.+)$/i);
        if (charDescMatch) {
          const charName = normalizeCharacterName(charDescMatch[1].trim());
          const charDesc = charDescMatch[2].trim();
          
          if (!characters.has(charName)) {
            // УЛУЧШЕНО: Извлекаем структурированные атрибуты из описания
            const attributes = extractCharacterAttributes(charDesc);
            
            characters.set(charName, {
              name: charName,
              variants: getNameVariants(charName),
              dialogueCount: 0,
              firstAppearance: lineIndex,
              description: charDesc,
              attributes: attributes,
            });
          } else {
            const char = characters.get(charName);
            if (char) {
              if (!char.description) {
                char.description = charDesc;
                char.attributes = extractCharacterAttributes(charDesc);
              } else if (!char.attributes) {
                // Обновляем атрибуты, если описание уже было
                char.attributes = extractCharacterAttributes(charDesc);
              }
            }
          }
        }
      }
      continue;
    }
    
    // Если есть текущий персонаж, это его реплика
    if (currentCharacter && line.length > 0 && !line.startsWith('(')) {
      const char = characters.get(currentCharacter);
      if (char) {
        char.dialogueCount++;
      }
      
      scriptLines.push({
        lineIndex: lineIndex++,
        character: currentCharacter,
        text: line,
        isOffscreen: currentIsOffscreen,
        isVoiceover: currentIsVoiceover,
      });
      
      // Сбрасываем флаги после реплики
      currentIsOffscreen = false;
      currentIsVoiceover = false;
    }
  }
  
  // Конвертируем Map в массив и сортируем по количеству реплик
  const charactersArray = Array.from(characters.values())
    .sort((a, b) => b.dialogueCount - a.dialogueCount);
  
  // Закрываем последнюю сцену
  if (currentScene) {
    currentScene.endLineIndex = lineIndex - 1;
  }
  
  console.log(`   📜 Parsed ${scenes.length} scenes with character lists`);
  if (scenes.length > 0) {
    const scenesWithChars = scenes.filter(s => s.characters.length > 0);
    console.log(`   📋 ${scenesWithChars.length} scenes have character lists`);
    if (scenesWithChars.length > 0) {
      console.log(`   📋 Example: Scene ${scenesWithChars[0].sceneNumber} - ${scenesWithChars[0].characters.join(', ')}`);
    }
  }
  
  return {
    title: extractTitle(text),
    characters: charactersArray,
    lines: scriptLines,
    scenes: scenes,
    rawText: text,
  };
}

/**
 * Парсит DOCX файл (новый формат Word)
 */
export async function parseDocxFile(buffer: Buffer): Promise<ParsedScript> {
  const result = await mammoth.extractRawText({ buffer });
  return parseScriptText(result.value);
}

/**
 * Парсит DOC файл (старый формат Word 97-2003)
 */
export async function parseDocFile(buffer: Buffer): Promise<ParsedScript> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  const text = doc.getBody();
  return parseScriptText(text);
}

/**
 * Парсит TXT файл
 */
export function parseTxtFile(text: string): ParsedScript {
  return parseScriptText(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Нормализует имя персонажа
 */
function normalizeCharacterName(name: string): string {
  // Убираем лишние пробелы и приводим к верхнему регистру
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Получает варианты имени персонажа
 * УНИВЕРСАЛЬНАЯ ВЕРСИЯ: не используем хардкод, только само имя
 * Варианты будут определяться из самого сценария при парсинге
 */
function getNameVariants(name: string): string[] {
  // Просто возвращаем имя как есть
  // Не делаем предположений о вариантах — берём из сценария
  return [name];
}

/**
 * Извлекает описание из ремарки
 */
function extractDescription(remark: string): string | undefined {
  if (!remark) return undefined;
  
  const match = remark.match(/\(\s*([^)]+)\s*\)/);
  if (match) {
    const desc = match[1].trim();
    // Убираем ЗК/ГЗК из описания
    if (OFFSCREEN_PATTERN.test(desc) || VOICEOVER_PATTERN.test(desc)) {
      return undefined;
    }
    return desc;
  }
  return undefined;
}

/**
 * Извлекает название из текста сценария
 */
function extractTitle(text: string): string {
  const lines = text.split('\n').slice(0, 20);
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Ищем строку в кавычках как название
    const quotedMatch = trimmed.match(/[«"]([^»"]+)[»"]/);
    if (quotedMatch) {
      return quotedMatch[1];
    }
    
    // Или строку полностью заглавными (название фильма)
    if (trimmed.length > 5 && trimmed.length < 100 && trimmed === trimmed.toUpperCase() && !IGNORED_NAMES.has(trimmed)) {
      return trimmed;
    }
  }
  
  return 'Без названия';
}

/**
 * Извлекает структурированные атрибуты персонажа из описания
 */
export function extractCharacterAttributes(description: string): CharacterAttributes {
  const attrs: CharacterAttributes = {};
  const lowerDesc = description.toLowerCase();
  
  // УЛУЧШЕНО: Семантическое определение пола
  // Проверяем более широкий набор паттернов с границами слов
  if (lowerDesc.match(/\b(женщин|девушк|девочк|дама|леди|барышн|мадам|мисс|миссис|бабушк|тет|тётя)\b/)) {
    attrs.gender = 'F';
  } else if (lowerDesc.match(/\b(мужчин|парен|мальчик|муж|господин|мистер|дедушк|дяд|дядя|юнош)\b/)) {
    attrs.gender = 'M';
  }
  
  // Цвет волос
  if (lowerDesc.includes('блондин') || lowerDesc.includes('светл') || lowerDesc.includes('русы')) {
    attrs.hairColor = 'blonde';
  } else if (lowerDesc.includes('брюнет') || lowerDesc.includes('тёмн') || lowerDesc.includes('чёрн')) {
    attrs.hairColor = 'dark';
  } else if (lowerDesc.includes('рыж')) {
    attrs.hairColor = 'red';
  } else if (lowerDesc.includes('седо') || lowerDesc.includes('сед ')) {
    attrs.hairColor = 'grey';
  }
  
  // УЛУЧШЕНО: Семантическое определение возраста
  const ageMatch = lowerDesc.match(/(\d{1,2})\s*-?\s*(\d{1,2})?\s*(лет|года|год|г\.)/);
  if (ageMatch) {
    attrs.ageRange = ageMatch[1] + (ageMatch[2] ? `-${ageMatch[2]}` : '');
  } else if (lowerDesc.match(/\b(молод|юн|подросток|студент|школьник)\b/)) {
    attrs.ageRange = '18-30';
  } else if (lowerDesc.match(/\b(средн|зрел|взросл)\b/)) {
    attrs.ageRange = '30-50';
  } else if (lowerDesc.match(/\b(пожил|старш|пенсионер|старик|старушк|дед|бабушк)\b/)) {
    attrs.ageRange = '50+';
  } else if (lowerDesc.match(/\b(ребёнок|малыш|дет|маленьк)\b/)) {
    attrs.ageRange = '0-18';
  }
  
  // Отличительные черты
  const features: string[] = [];
  if (lowerDesc.includes('очк')) features.push('glasses');
  if (lowerDesc.includes('бород')) features.push('beard');
  if (lowerDesc.includes('ус ') || lowerDesc.includes('усы')) features.push('mustache');
  if (lowerDesc.includes('шрам')) features.push('scar');
  if (lowerDesc.includes('тату')) features.push('tattoo');
  if (features.length > 0) attrs.distinctiveFeatures = features;
  
  // Одежда
  const clothing: string[] = [];
  if (lowerDesc.includes('костюм')) clothing.push('suit');
  if (lowerDesc.includes('платье')) clothing.push('dress');
  if (lowerDesc.includes('форм')) clothing.push('uniform');
  if (lowerDesc.includes('халат')) clothing.push('robe');
  if (lowerDesc.includes('золот')) clothing.push('gold');
  if (clothing.length > 0) attrs.clothing = clothing;
  
  return attrs;
}

/**
 * Создаёт карту вариантов имён для быстрого поиска
 */
export function createVariantMap(characters: ScriptCharacter[]): Map<string, string> {
  const variantMap = new Map<string, string>();
  
  for (const char of characters) {
    // Основное имя
    variantMap.set(char.name.toUpperCase(), char.name);
    
    // Все варианты
    for (const variant of char.variants) {
      variantMap.set(variant.toUpperCase(), char.name);
    }
  }
  
  return variantMap;
}
