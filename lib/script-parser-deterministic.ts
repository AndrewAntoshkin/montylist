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

export interface ParsedScript {
  title: string;
  characters: ScriptCharacter[];
  lines: ScriptLine[];
  rawText: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПАТТЕРНЫ ДЛЯ ПАРСИНГА
// ═══════════════════════════════════════════════════════════════════════════

// Паттерн: ИМЯ ПЕРСОНАЖА (всё заглавными, может быть с ремаркой в скобках)
const CHARACTER_NAME_PATTERN = /^([А-ЯЁA-Z][А-ЯЁA-Z\s\-]{1,30})(\s*\(.*?\))?\s*$/;

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

// Варианты имён (сокращения и производные)
const NAME_VARIANTS: Record<string, string[]> = {
  'АЛЕКСАНДР': ['САША', 'САНЯ', 'ШУРА', 'АЛЕКС'],
  'АЛЕКСАНДРА': ['САША', 'ШУРА', 'АЛЕКСА'],
  'АЛЕКСЕЙ': ['ЛЁША', 'ЛЁХА', 'АЛЁША'],
  'АНАСТАСИЯ': ['НАСТЯ', 'НАСТЕНЬКА', 'НАСТЮША'],
  'АНДРЕЙ': ['АНДРЮША', 'АНДРЮХА'],
  'АННА': ['АНЯ', 'АНЮТА', 'НЮРА', 'НЮША'],
  'БОРИС': ['БОРЯ', 'БОРЬКА'],
  'ВАЛЕНТИНА': ['ВАЛЯ', 'ВАЛЮША'],
  'ВАСИЛИЙ': ['ВАСЯ', 'ВАСЬКА'],
  'ВИКТОР': ['ВИТЯ', 'ВИТЁК'],
  'ВИКТОРИЯ': ['ВИКА', 'ВИКУСЯ'],
  'ВЛАДИМИР': ['ВОВА', 'ВОЛОДЯ', 'ВОВКА'],
  'ГАЛИНА': ['ГАЛЯ', 'ГАЛЮНЯ', 'ГАЛОЧКА'],
  'ДАРЬЯ': ['ДАША', 'ДАШЕНЬКА', 'ДАШУЛЯ'],
  'ДМИТРИЙ': ['ДИМА', 'ДИМКА', 'МИТЯ'],
  'ЕВГЕНИЙ': ['ЖЕНЯ', 'ЖЕНЬКА', 'ЖЕКА'],
  'ЕВГЕНИЯ': ['ЖЕНЯ', 'ЖЕНЕЧКА'],
  'ЕКАТЕРИНА': ['КАТЯ', 'КАТЕНЬКА', 'КАТЮША'],
  'ЕЛЕНА': ['ЛЕНА', 'ЛЕНОЧКА', 'АЛЁНА'],
  'ИВАН': ['ВАНЯ', 'ВАНЬКА', 'ВАНЮША'],
  'ИРИНА': ['ИРА', 'ИРОЧКА', 'ИРУСЯ'],
  'КОНСТАНТИН': ['КОСТЯ', 'КОСТИК'],
  'ЛЮДМИЛА': ['ЛЮДА', 'ЛЮДОЧКА', 'МИЛА'],
  'МАРГАРИТА': ['РИТА', 'МАРГО'],
  'МАРИЯ': ['МАША', 'МАШЕНЬКА', 'МАРУСЯ'],
  'МИХАИЛ': ['МИША', 'МИШКА'],
  'НАТАЛЬЯ': ['НАТАША', 'НАТАШЕНЬКА', 'НАТА'],
  'НИКОЛАЙ': ['КОЛЯ', 'КОЛЬКА', 'НИКОЛАША'],
  'ОЛЬГА': ['ОЛЯ', 'ОЛЕНЬКА', 'ОЛЕЧКА'],
  'ПАВЕЛ': ['ПАША', 'ПАШКА'],
  'ПЁТР': ['ПЕТЯ', 'ПЕТЬКА', 'ПЕТРУША'],
  'СВЕТЛАНА': ['СВЕТА', 'СВЕТОЧКА', 'СВЕТИК'],
  'СЕРГЕЙ': ['СЕРЁЖА', 'СЕРЁГА', 'СЕРЖ'],
  'ТАТЬЯНА': ['ТАНЯ', 'ТАНЮША', 'ТАНЕЧКА'],
  'ЮЛИЯ': ['ЮЛЯ', 'ЮЛЕНЬКА', 'ЮЛЕЧКА'],
  'ЮРИЙ': ['ЮРА', 'ЮРИК', 'ЮРКА'],
  'ЮСЕФ': ['ЮСУФ', 'ЮСИК'],
  'ТОМА': ['ТАМАРА', 'ТОМОЧКА'],
};

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
  
  let currentCharacter: string | null = null;
  let currentIsOffscreen = false;
  let currentIsVoiceover = false;
  let lineIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Проверяем, это имя персонажа?
    const nameMatch = line.match(CHARACTER_NAME_PATTERN);
    if (nameMatch) {
      const rawName = nameMatch[1].trim();
      const remark = nameMatch[2] || '';
      
      // Проверяем, не игнорируемое ли это слово
      if (IGNORED_NAMES.has(rawName)) {
        currentCharacter = null;
        continue;
      }
      
      currentCharacter = normalizeCharacterName(rawName);
      currentIsOffscreen = OFFSCREEN_PATTERN.test(remark);
      currentIsVoiceover = VOICEOVER_PATTERN.test(remark);
      
      // Добавляем/обновляем персонажа
      if (!characters.has(currentCharacter)) {
        characters.set(currentCharacter, {
          name: currentCharacter,
          variants: getNameVariants(currentCharacter),
          dialogueCount: 0,
          firstAppearance: lineIndex,
          description: extractDescription(remark),
        });
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
  
  return {
    title: extractTitle(text),
    characters: charactersArray,
    lines: scriptLines,
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
 */
function getNameVariants(name: string): string[] {
  const variants = [name];
  
  // Проверяем, есть ли известные варианты
  const knownVariants = NAME_VARIANTS[name];
  if (knownVariants) {
    variants.push(...knownVariants);
  }
  
  // Добавляем сокращённые формы (первые 3-4 буквы)
  if (name.length > 4) {
    variants.push(name.substring(0, 4));
  }
  
  return [...new Set(variants)];
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
  
  // Пол
  if (lowerDesc.includes('женщин') || lowerDesc.includes('девушк') || lowerDesc.includes('девочк')) {
    attrs.gender = 'F';
  } else if (lowerDesc.includes('мужчин') || lowerDesc.includes('парен') || lowerDesc.includes('мальчик')) {
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
  
  // Возраст
  const ageMatch = lowerDesc.match(/(\d{1,2})\s*-?\s*(\d{1,2})?\s*(лет|года|год)/);
  if (ageMatch) {
    attrs.ageRange = ageMatch[1] + (ageMatch[2] ? `-${ageMatch[2]}` : '');
  } else if (lowerDesc.includes('молод')) {
    attrs.ageRange = '20-35';
  } else if (lowerDesc.includes('пожил') || lowerDesc.includes('старш')) {
    attrs.ageRange = '50+';
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
