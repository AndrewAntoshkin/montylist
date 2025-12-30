/**
 * Script Characters Module
 * 
 * Управляет персонажами, извлечёнными из сценария.
 * Обеспечивает сопоставление и замену имён.
 */

import type { ScriptCharacter, ParsedScript } from './script-parser';

export interface CharacterMatch {
  originalName: string;      // Имя из монтажного листа (ЖЕНЩИНА, ДЕВУШКА)
  matchedCharacter: string;  // Найденный персонаж из сценария (ТОМА)
  confidence: number;        // Уверенность (0-1)
  reason: string;            // Причина сопоставления
}

export interface CharacterContext {
  characters: ScriptCharacter[];
  mainCharacters: string[];      // Имена главных персонажей
  femaleCharacters: string[];    // Женские персонажи
  maleCharacters: string[];      // Мужские персонажи
  variantMap: Map<string, string>;  // Вариант -> каноническое имя
}

/**
 * Создаёт контекст персонажей из распарсенного сценария
 */
export function createCharacterContext(script: ParsedScript): CharacterContext {
  const characters = script.characters;
  
  // Главные персонажи (5+ реплик)
  const mainCharacters = characters
    .filter(c => c.dialogueCount >= 5)
    .map(c => c.name);
  
  // По полу
  const femaleCharacters = characters
    .filter(c => c.gender === 'female')
    .map(c => c.name);
  
  const maleCharacters = characters
    .filter(c => c.gender === 'male')
    .map(c => c.name);
  
  // Карта вариантов
  const variantMap = new Map<string, string>();
  for (const char of characters) {
    for (const variant of char.variants) {
      variantMap.set(variant.toUpperCase(), char.name);
    }
    variantMap.set(char.normalizedName, char.name);
  }
  
  return {
    characters,
    mainCharacters,
    femaleCharacters,
    maleCharacters,
    variantMap,
  };
}

/**
 * Находит персонажа по имени или варианту
 */
export function findCharacter(
  context: CharacterContext,
  name: string
): ScriptCharacter | undefined {
  const upper = name.toUpperCase().trim();
  
  // Прямое совпадение
  const direct = context.characters.find(c => c.name === upper);
  if (direct) return direct;
  
  // По варианту
  const canonical = context.variantMap.get(upper);
  if (canonical) {
    return context.characters.find(c => c.name === canonical);
  }
  
  // По нормализованному имени
  return context.characters.find(c => c.normalizedName === upper);
}

/**
 * Пытается сопоставить generic имя с персонажем
 */
export function matchGenericToCharacter(
  context: CharacterContext,
  genericName: string,
  sceneDescription?: string
): CharacterMatch | null {
  const upper = genericName.toUpperCase().trim();
  
  // Определяем тип generic имени
  const isFemale = ['ЖЕНЩИНА', 'ДЕВУШКА', 'ДЕВОЧКА', 'ДАМА'].includes(upper);
  const isMale = ['МУЖЧИНА', 'ПАРЕНЬ', 'МУЖ', 'МУЖИК', 'ЧЕЛОВЕК'].includes(upper);
  
  if (!isFemale && !isMale) {
    return null; // Не generic имя
  }
  
  // Получаем кандидатов по полу
  const candidates = isFemale 
    ? context.femaleCharacters 
    : context.maleCharacters;
  
  if (candidates.length === 0) {
    return null;
  }
  
  // Если есть описание сцены, ищем упоминания персонажей
  if (sceneDescription) {
    const descUpper = sceneDescription.toUpperCase();
    
    for (const candidate of candidates) {
      // Проверяем все варианты имени
      const char = context.characters.find(c => c.name === candidate);
      if (!char) continue;
      
      for (const variant of char.variants) {
        if (descUpper.includes(variant)) {
          return {
            originalName: genericName,
            matchedCharacter: candidate,
            confidence: 0.9,
            reason: `Имя "${variant}" упоминается в описании сцены`,
          };
        }
      }
    }
  }
  
  // Если кандидат только один — высокая уверенность
  if (candidates.length === 1) {
    return {
      originalName: genericName,
      matchedCharacter: candidates[0],
      confidence: 0.8,
      reason: 'Единственный персонаж подходящего пола',
    };
  }
  
  // Возвращаем главного персонажа (первый по количеству реплик)
  const mainCandidate = candidates.find(c => context.mainCharacters.includes(c));
  if (mainCandidate) {
    return {
      originalName: genericName,
      matchedCharacter: mainCandidate,
      confidence: 0.5,
      reason: 'Главный персонаж подходящего пола (требует проверки)',
    };
  }
  
  return null;
}

/**
 * Заменяет generic имена на реальные в диалогах
 */
export function replaceGenericNames(
  dialogues: string,
  context: CharacterContext,
  description?: string
): { result: string; replacements: CharacterMatch[] } {
  const replacements: CharacterMatch[] = [];
  let result = dialogues;
  
  // Паттерны для generic имён в диалогах
  const patterns = [
    /^(ЖЕНЩИНА|ДЕВУШКА|МУЖЧИНА|ПАРЕНЬ)$/gm,           // Отдельная строка
    /^(ЖЕНЩИНА|ДЕВУШКА|МУЖЧИНА|ПАРЕНЬ)\s+(ЗК|ГЗ|ГЗК)$/gm,  // С голосом за кадром
  ];
  
  for (const pattern of patterns) {
    result = result.replace(pattern, (match, name, modifier) => {
      const matchResult = matchGenericToCharacter(context, name, description);
      
      if (matchResult && matchResult.confidence >= 0.7) {
        replacements.push(matchResult);
        return modifier 
          ? `${matchResult.matchedCharacter} ${modifier}`
          : matchResult.matchedCharacter;
      }
      
      return match; // Оставляем как есть
    });
  }
  
  return { result, replacements };
}

/**
 * Валидирует имена персонажей в монтажном листе
 */
export function validateCharacterNames(
  entries: Array<{ dialogues?: string; description?: string }>,
  context: CharacterContext
): {
  validNames: string[];
  unknownNames: string[];
  genericNames: string[];
} {
  const validNames = new Set<string>();
  const unknownNames = new Set<string>();
  const genericNames = new Set<string>();
  
  // Паттерн для извлечения имён из диалогов
  const speakerPattern = /^([А-ЯЁA-Z][А-ЯЁA-Z\s]+?)(?:\s+(?:ЗК|ГЗ|ГЗК))?\s*$/gm;
  
  const genericSet = new Set(['ЖЕНЩИНА', 'ДЕВУШКА', 'МУЖЧИНА', 'ПАРЕНЬ', 'МУЖ', 'ЧЕЛОВЕК', 'ГОЛОС']);
  
  for (const entry of entries) {
    const dialogues = entry.dialogues || '';
    
    let match;
    while ((match = speakerPattern.exec(dialogues)) !== null) {
      const name = match[1].trim();
      
      if (genericSet.has(name)) {
        genericNames.add(name);
      } else if (findCharacter(context, name)) {
        validNames.add(name);
      } else {
        unknownNames.add(name);
      }
    }
  }
  
  return {
    validNames: Array.from(validNames),
    unknownNames: Array.from(unknownNames),
    genericNames: Array.from(genericNames),
  };
}

/**
 * Обогащает промпт информацией о персонажах
 */
export function enrichPromptWithCharacters(
  basePrompt: string,
  context: CharacterContext
): string {
  if (!context.characters || context.characters.length === 0) {
    return basePrompt;
  }
  
  const characterSection = formatCharacterSection(context);
  
  // Вставляем секцию персонажей перед основными инструкциями
  return characterSection + '\n\n' + basePrompt;
}

function formatCharacterSection(context: CharacterContext): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('📋 ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ — ИСПОЛЬЗУЙ ЭТИ ИМЕНА!');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Главные персонажи
  const mainChars = context.characters
    .filter(c => context.mainCharacters.includes(c.name))
    .slice(0, 10);
  
  if (mainChars.length > 0) {
    lines.push('🌟 ГЛАВНЫЕ ПЕРСОНАЖИ (запомни их!):');
    for (const char of mainChars) {
      const gender = char.gender === 'female' ? '(жен.)' : char.gender === 'male' ? '(муж.)' : '';
      lines.push(`   • ${char.name} ${gender}`);
    }
    lines.push('');
  }
  
  // Второстепенные
  const secondaryChars = context.characters
    .filter(c => !context.mainCharacters.includes(c.name))
    .slice(0, 15);
  
  if (secondaryChars.length > 0) {
    lines.push('👤 ВТОРОСТЕПЕННЫЕ:');
    lines.push(`   ${secondaryChars.map(c => c.name).join(', ')}`);
    lines.push('');
  }
  
  lines.push('');
  lines.push('⚠️  ПРАВИЛО: НЕ пиши "ЖЕНЩИНА" или "МУЖЧИНА" если можешь определить,');
  lines.push('   кто именно из персонажей в кадре. Используй имена из списка!');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

