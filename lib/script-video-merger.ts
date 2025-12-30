/**
 * Script-Video Merger Module
 * 
 * Объединяет данные из сценария с результатами анализа видео.
 * Заменяет generic имена на реальные, нормализует персонажей.
 */

import type { ScriptData, ScriptCharacterInfo, MontageEntry } from '@/types';

export interface MergeResult {
  entries: Array<{
    id?: string;
    description?: string;
    dialogues?: string;
  }>;
  replacements: Array<{
    entryId?: string;
    original: string;
    replaced: string;
    reason: string;
  }>;
  stats: {
    totalEntries: number;
    entriesWithDialogues: number;
    replacementsMade: number;
    genericNamesFound: string[];
    unknownNamesFound: string[];
  };
}

// Generic имена, которые нужно заменять
const GENERIC_FEMALE = new Set(['ЖЕНЩИНА', 'ДЕВУШКА', 'ДЕВОЧКА', 'ДАМА', 'МОЛОДАЯ ЖЕНЩИНА']);
const GENERIC_MALE = new Set(['МУЖЧИНА', 'ПАРЕНЬ', 'МУЖИК', 'МОЛОДОЙ ЧЕЛОВЕК']);
const GENERIC_NEUTRAL = new Set(['ЧЕЛОВЕК', 'ГОЛОС', 'ПЕРСОНА']);

/**
 * Объединяет данные из сценария с монтажным листом
 */
export function mergeScriptWithMontage(
  entries: Array<{ id?: string; description?: string; dialogues?: string }>,
  scriptData: ScriptData
): MergeResult {
  const replacements: MergeResult['replacements'] = [];
  const genericNamesFound = new Set<string>();
  const unknownNamesFound = new Set<string>();
  
  // Создаём индекс персонажей
  const characterIndex = createCharacterIndex(scriptData.characters);
  
  // Обрабатываем каждую запись
  const processedEntries = entries.map(entry => {
    if (!entry.dialogues) {
      return entry;
    }
    
    const { result, entryReplacements, generics, unknowns } = processDialogues(
      entry.dialogues,
      entry.description || '',
      characterIndex,
      entry.id
    );
    
    replacements.push(...entryReplacements);
    generics.forEach(g => genericNamesFound.add(g));
    unknowns.forEach(u => unknownNamesFound.add(u));
    
    if (result !== entry.dialogues) {
      return { ...entry, dialogues: result };
    }
    
    return entry;
  });
  
  const entriesWithDialogues = entries.filter(e => e.dialogues && e.dialogues.trim()).length;
  
  return {
    entries: processedEntries,
    replacements,
    stats: {
      totalEntries: entries.length,
      entriesWithDialogues,
      replacementsMade: replacements.length,
      genericNamesFound: Array.from(genericNamesFound),
      unknownNamesFound: Array.from(unknownNamesFound),
    },
  };
}

interface CharacterIndex {
  all: Map<string, ScriptCharacterInfo>;          // Все персонажи
  byVariant: Map<string, ScriptCharacterInfo>;    // По вариантам имени
  females: ScriptCharacterInfo[];                  // Женские
  males: ScriptCharacterInfo[];                    // Мужские
  main: Set<string>;                               // Главные (много реплик)
}

function createCharacterIndex(characters: ScriptCharacterInfo[]): CharacterIndex {
  const all = new Map<string, ScriptCharacterInfo>();
  const byVariant = new Map<string, ScriptCharacterInfo>();
  const females: ScriptCharacterInfo[] = [];
  const males: ScriptCharacterInfo[] = [];
  const main = new Set<string>();
  
  for (const char of characters) {
    all.set(char.name, char);
    
    // По вариантам
    for (const variant of char.variants) {
      byVariant.set(variant.toUpperCase(), char);
    }
    byVariant.set(char.normalizedName, char);
    
    // По полу
    if (char.gender === 'female') {
      females.push(char);
    } else if (char.gender === 'male') {
      males.push(char);
    }
    
    // Главные персонажи (5+ реплик)
    if (char.dialogueCount >= 5) {
      main.add(char.name);
    }
  }
  
  // Сортируем по количеству реплик
  females.sort((a, b) => b.dialogueCount - a.dialogueCount);
  males.sort((a, b) => b.dialogueCount - a.dialogueCount);
  
  return { all, byVariant, females, males, main };
}

interface ProcessResult {
  result: string;
  entryReplacements: MergeResult['replacements'];
  generics: string[];
  unknowns: string[];
}

function processDialogues(
  dialogues: string,
  description: string,
  index: CharacterIndex,
  entryId?: string
): ProcessResult {
  const entryReplacements: MergeResult['replacements'] = [];
  const generics: string[] = [];
  const unknowns: string[] = [];
  
  // Паттерн для спикера в диалогах
  // "ИМЯ" или "ИМЯ ЗК" или "ИМЯ ГЗ"
  const speakerPattern = /^([А-ЯЁA-Z][А-ЯЁA-Z\s]+?)(\s+(?:ЗК|ГЗ|ГЗК))?\s*$/gm;
  
  let result = dialogues;
  let match;
  
  // Собираем все замены сначала, потом применяем
  const replacementsToMake: Array<{ from: string; to: string; reason: string }> = [];
  
  while ((match = speakerPattern.exec(dialogues)) !== null) {
    const fullMatch = match[0];
    const speaker = match[1].trim();
    const modifier = match[2]?.trim() || '';
    
    // Проверяем, это generic имя?
    const upperSpeaker = speaker.toUpperCase();
    
    if (GENERIC_FEMALE.has(upperSpeaker)) {
      generics.push(upperSpeaker);
      const replacement = findBestMatch(upperSpeaker, description, index, 'female');
      if (replacement) {
        replacementsToMake.push({
          from: fullMatch,
          to: `${replacement}${modifier}`,
          reason: 'Замена generic женского имени',
        });
      }
    } else if (GENERIC_MALE.has(upperSpeaker)) {
      generics.push(upperSpeaker);
      const replacement = findBestMatch(upperSpeaker, description, index, 'male');
      if (replacement) {
        replacementsToMake.push({
          from: fullMatch,
          to: `${replacement}${modifier}`,
          reason: 'Замена generic мужского имени',
        });
      }
    } else if (GENERIC_NEUTRAL.has(upperSpeaker)) {
      generics.push(upperSpeaker);
      // Для нейтральных — ищем по описанию
      const replacement = findBestMatch(upperSpeaker, description, index, null);
      if (replacement) {
        replacementsToMake.push({
          from: fullMatch,
          to: `${replacement}${modifier}`,
          reason: 'Замена generic нейтрального имени',
        });
      }
    } else {
      // Проверяем, известен ли персонаж
      if (!index.all.has(upperSpeaker) && !index.byVariant.has(upperSpeaker)) {
        unknowns.push(upperSpeaker);
      }
    }
  }
  
  // Применяем замены
  for (const { from, to, reason } of replacementsToMake) {
    result = result.replace(from, to);
    entryReplacements.push({
      entryId,
      original: from.trim(),
      replaced: to.trim(),
      reason,
    });
  }
  
  return { result, entryReplacements, generics, unknowns };
}

function findBestMatch(
  genericName: string,
  description: string,
  index: CharacterIndex,
  gender: 'female' | 'male' | null
): string | null {
  const descUpper = description.toUpperCase();
  
  // Выбираем кандидатов по полу
  let candidates: ScriptCharacterInfo[];
  if (gender === 'female') {
    candidates = index.females;
  } else if (gender === 'male') {
    candidates = index.males;
  } else {
    // Объединяем всех
    candidates = [...index.females, ...index.males];
  }
  
  if (candidates.length === 0) {
    return null;
  }
  
  // 1. Ищем прямое упоминание в описании
  for (const char of candidates) {
    for (const variant of char.variants) {
      if (descUpper.includes(variant)) {
        return char.name;
      }
    }
    if (descUpper.includes(char.name)) {
      return char.name;
    }
  }
  
  // 2. Если только один кандидат — возвращаем его
  if (candidates.length === 1) {
    return candidates[0].name;
  }
  
  // 3. Если много кандидатов — возвращаем главного (самого частого)
  // Но только если он действительно главный
  const mainCandidate = candidates.find(c => index.main.has(c.name));
  if (mainCandidate && candidates.length <= 3) {
    return mainCandidate.name;
  }
  
  // 4. Не можем определить уверенно — не заменяем
  return null;
}

/**
 * Применяет данные сценария к промпту Gemini
 */
export function createEnrichedPrompt(
  basePrompt: string,
  scriptData: ScriptData
): string {
  if (!scriptData.characters || scriptData.characters.length === 0) {
    return basePrompt;
  }
  
  const characterSection = buildCharacterSection(scriptData);
  
  // Вставляем секцию в начало промпта
  return characterSection + '\n\n' + basePrompt;
}

function buildCharacterSection(scriptData: ScriptData): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('📋 ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ — ЭТО ГЛАВНАЯ ИНФОРМАЦИЯ!');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Главные персонажи
  const main = scriptData.characters.filter(c => c.dialogueCount >= 5);
  if (main.length > 0) {
    lines.push('🌟 ГЛАВНЫЕ ПЕРСОНАЖИ (ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ!):');
    for (const char of main.slice(0, 10)) {
      const genderText = char.gender === 'female' ? '♀ жен.' 
        : char.gender === 'male' ? '♂ муж.' 
        : '';
      lines.push(`   • ${char.name} — ${genderText} (${char.dialogueCount} реплик в сценарии)`);
    }
    lines.push('');
  }
  
  // Второстепенные
  const secondary = scriptData.characters.filter(c => c.dialogueCount >= 2 && c.dialogueCount < 5);
  if (secondary.length > 0) {
    lines.push('👤 ВТОРОСТЕПЕННЫЕ:');
    lines.push(`   ${secondary.map(c => c.name).join(', ')}`);
    lines.push('');
  }
  
  // Эпизодические
  const minor = scriptData.characters.filter(c => c.dialogueCount === 1);
  if (minor.length > 0 && minor.length <= 15) {
    lines.push('👥 ЭПИЗОДИЧЕСКИЕ:');
    lines.push(`   ${minor.map(c => c.name).join(', ')}`);
    lines.push('');
  }
  
  lines.push('');
  lines.push('⚠️  СТРОЖАЙШЕЕ ПРАВИЛО:');
  lines.push('   ❌ НЕ пиши "ЖЕНЩИНА", "ДЕВУШКА", "МУЖЧИНА", "ПАРЕНЬ"');
  lines.push('   ✅ ВСЕГДА используй имена из списка выше!');
  lines.push('');
  lines.push('   Если видишь персонажа — определи КТО это по внешности');
  lines.push('   и используй правильное имя из сценария.');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Валидирует результат анализа против данных сценария
 */
export function validateAgainstScript(
  entries: Array<{ dialogues?: string }>,
  scriptData: ScriptData
): {
  isValid: boolean;
  issues: string[];
  genericUsageCount: number;
  knownCharactersUsed: string[];
} {
  const issues: string[] = [];
  let genericUsageCount = 0;
  const knownCharactersUsed = new Set<string>();
  
  const knownNames = new Set(scriptData.characters.map(c => c.name));
  const allVariants = new Set<string>();
  for (const char of scriptData.characters) {
    for (const v of char.variants) {
      allVariants.add(v.toUpperCase());
    }
  }
  
  const speakerPattern = /^([А-ЯЁA-Z][А-ЯЁA-Z\s]+?)(?:\s+(?:ЗК|ГЗ|ГЗК))?\s*$/gm;
  
  for (const entry of entries) {
    if (!entry.dialogues) continue;
    
    let match;
    while ((match = speakerPattern.exec(entry.dialogues)) !== null) {
      const speaker = match[1].trim().toUpperCase();
      
      if (GENERIC_FEMALE.has(speaker) || GENERIC_MALE.has(speaker) || GENERIC_NEUTRAL.has(speaker)) {
        genericUsageCount++;
      } else if (knownNames.has(speaker) || allVariants.has(speaker)) {
        knownCharactersUsed.add(speaker);
      }
    }
  }
  
  // Проверки
  if (genericUsageCount > entries.length * 0.1) {
    issues.push(`Слишком много generic имён: ${genericUsageCount} (>10% от планов)`);
  }
  
  const mainCharacters = scriptData.characters.filter(c => c.dialogueCount >= 10);
  for (const char of mainCharacters) {
    if (!knownCharactersUsed.has(char.name)) {
      const variantUsed = char.variants.some(v => knownCharactersUsed.has(v.toUpperCase()));
      if (!variantUsed) {
        issues.push(`Главный персонаж ${char.name} не появляется в результате`);
      }
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    genericUsageCount,
    knownCharactersUsed: Array.from(knownCharactersUsed),
  };
}

