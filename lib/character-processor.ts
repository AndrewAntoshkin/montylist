/**
 * Character Post-Processing Module
 * 
 * Анализирует монтажный лист после склейки всех чанков и:
 * 1. Извлекает имена персонажей из титров
 * 2. Строит timeline появления персонажей
 * 3. Заменяет "ЖЕНЩИНА/МУЖЧИНА" на реальные имена после первого появления в титрах
 */

export interface Character {
  name: string;           // Имя персонажа (ГАЛЯ, ТОМА)
  fullName: string;       // Полное имя (Галина)
  actor?: string;         // Имя актёра
  firstAppearance: number; // Номер плана первого появления
  timecode: string;       // Таймкод первого появления
}

export interface CharacterProcessingResult {
  characters: Character[];
  replacements: number;    // Сколько замен сделано
  warnings: string[];
}

/**
 * Извлекает персонажей из титров в описаниях планов
 * Паттерны:
 * - "Титр\nГалина – Полина Нечитайло"
 * - "Титр\nТома – Анна Татаренко"
 * - "Титр ГАЛЯ - Полина Нечитайло"
 */
export function extractCharactersFromTitles(entries: any[]): Character[] {
  const characters: Character[] = [];
  const seenNames = new Set<string>();
  
  // Паттерны для поиска титров с именами
  const titlePatterns = [
    // "Галина – Полина Нечитайло" или "ГАЛЯ - Полина"
    /(?:Титр\s*\n?\s*)?([А-ЯЁ][а-яё]+|[А-ЯЁ]+)\s*[–\-—]\s*([А-ЯЁ][а-яё]+\s*[А-ЯЁ]?[а-яё]*)/g,
  ];
  
  for (const entry of entries) {
    const description = entry.description || '';
    
    // Ищем титры
    if (description.includes('Титр') || description.includes('титр')) {
      for (const pattern of titlePatterns) {
        pattern.lastIndex = 0; // Reset regex
        let match;
        
        while ((match = pattern.exec(description)) !== null) {
          const characterName = match[1].trim();
          const actorName = match[2]?.trim();
          
          // Пропускаем если это не имя персонажа (например, название компании)
          if (isLikelyCharacterName(characterName) && !seenNames.has(characterName.toUpperCase())) {
            const shortName = getShortName(characterName);
            
            characters.push({
              name: shortName.toUpperCase(),
              fullName: characterName,
              actor: actorName,
              firstAppearance: entry.plan_number,
              timecode: entry.start_timecode,
            });
            
            seenNames.add(shortName.toUpperCase());
            seenNames.add(characterName.toUpperCase());
          }
        }
      }
    }
  }
  
  // Сортируем по порядку появления
  characters.sort((a, b) => a.firstAppearance - b.firstAppearance);
  
  return characters;
}

/**
 * Проверяет, похоже ли это на имя персонажа
 */
function isLikelyCharacterName(name: string): boolean {
  // Исключаем слова, которые не являются именами
  const excludeWords = [
    'РЕЖИССЕР', 'РЕЖИССЁР', 'ПРОДЮСЕР', 'ОПЕРАТОР', 'СЦЕНАРИЙ',
    'МУЗЫКА', 'МОНТАЖ', 'ХУДОЖНИК', 'ЗВУК', 'ДИРЕКТОР',
    'ТЕЛЕКОМПАНИЯ', 'ПАРТНЕР', 'ПАРТНЁР', 'ФИЛЬМ', 'СЕРИАЛ',
    'ПРОИЗВОДСТВО', 'СЕРИЯ', 'СЕЗОН'
  ];
  
  const upperName = name.toUpperCase();
  return !excludeWords.some(word => upperName.includes(word));
}

/**
 * Получает короткое имя из полного
 * "Галина" -> "ГАЛЯ"
 * "Татьяна" -> "ТАНЯ"
 */
function getShortName(fullName: string): string {
  const shortNames: Record<string, string> = {
    'ГАЛИНА': 'ГАЛЯ',
    'ТАТЬЯНА': 'ТАНЯ',
    'НАТАЛЬЯ': 'НАТАША',
    'ЕКАТЕРИНА': 'КАТЯ',
    'АЛЕКСАНДР': 'САША',
    'АЛЕКСАНДРА': 'САША',
    'ДМИТРИЙ': 'ДИМА',
    'ВЛАДИМИР': 'ВОВА',
    'ЕВГЕНИЙ': 'ЖЕНЯ',
    'ЕВГЕНИЯ': 'ЖЕНЯ',
    'НИКОЛАЙ': 'КОЛЯ',
    'МИХАИЛ': 'МИША',
    'АНАСТАСИЯ': 'НАСТЯ',
    'ЕЛЕНА': 'ЛЕНА',
    'ОЛЬГА': 'ОЛЯ',
    'СВЕТЛАНА': 'СВЕТА',
    'ЛЮДМИЛА': 'ЛЮДА',
    'МАРИЯ': 'МАША',
    'ВАЛЕНТИНА': 'ВАЛЯ',
    'ЛЮБОВЬ': 'ЛЮБА',
  };
  
  const upperName = fullName.toUpperCase();
  return shortNames[upperName] || upperName;
}

/**
 * Находит placeholder-ы для персонажей и пытается их идентифицировать
 */
function findUnknownCharacters(entries: any[]): { planNumber: number; placeholder: string; context: string }[] {
  const unknowns: { planNumber: number; placeholder: string; context: string }[] = [];
  
  const placeholderPatterns = [
    /\b(ЖЕНЩИНА|МУЖЧИНА|ДЕВУШКА|ПАРЕНЬ)\b/g,
    /\(([Жж]енщина|[Мм]ужчина|[Дд]евушка|[Пп]арень)\)/g,
  ];
  
  for (const entry of entries) {
    const dialogues = entry.dialogues || '';
    const description = entry.description || '';
    const combined = `${dialogues} ${description}`;
    
    for (const pattern of placeholderPatterns) {
      pattern.lastIndex = 0;
      let match;
      
      while ((match = pattern.exec(combined)) !== null) {
        unknowns.push({
          planNumber: entry.plan_number,
          placeholder: match[1].toUpperCase(),
          context: combined.substring(Math.max(0, match.index - 30), match.index + 50),
        });
      }
    }
  }
  
  return unknowns;
}

/**
 * Заменяет placeholder-ы на реальные имена персонажей
 * Только для планов ПОСЛЕ первого появления персонажа в титрах
 */
export function replaceUnknownCharacters(
  entries: any[],
  characters: Character[]
): { entries: any[]; replacements: number; warnings: string[] } {
  const warnings: string[] = [];
  let replacements = 0;
  
  // Создаём карту: placeholder → персонаж
  // Простая эвристика: ЖЕНЩИНА → первая женщина из титров
  const femaleCharacter = characters.find(c => 
    ['ГАЛЯ', 'ТОМА', 'ТАНЯ', 'НАТАША', 'КАТЯ', 'НАСТЯ', 'ЛЕНА', 'ОЛЯ', 'СВЕТА', 'ЛЮДА', 'МАША', 'ВАЛЯ', 'ЛЮБА', 'БЕЛЛА', 'МАРИНА'].includes(c.name)
  );
  
  const maleCharacter = characters.find(c => 
    ['САША', 'ДИМА', 'ВОВА', 'ЖЕНЯ', 'КОЛЯ', 'МИША', 'ЮСЕФ', 'ОЛЕГ', 'ИГОРЬ', 'СЕРГЕЙ', 'АНДРЕЙ', 'ПАВЕЛ'].includes(c.name)
  );
  
  // Клонируем entries для модификации
  const updatedEntries = entries.map(entry => {
    const entryClone = { ...entry };
    let dialogues = entryClone.dialogues || '';
    let description = entryClone.description || '';
    let modified = false;
    
    // Заменяем только если план идёт ПОСЛЕ появления персонажа в титрах
    if (femaleCharacter && entry.plan_number > femaleCharacter.firstAppearance) {
      const beforeDialogues = dialogues;
      const beforeDescription = description;
      
      dialogues = dialogues.replace(/\bЖЕНЩИНА\b/g, femaleCharacter.name);
      dialogues = dialogues.replace(/\bДЕВУШКА\b/g, femaleCharacter.name);
      description = description.replace(/\bженщина\b/gi, femaleCharacter.fullName.toLowerCase());
      description = description.replace(/\bдевушка\b/gi, femaleCharacter.fullName.toLowerCase());
      
      if (dialogues !== beforeDialogues || description !== beforeDescription) {
        modified = true;
        replacements++;
      }
    }
    
    if (maleCharacter && entry.plan_number > maleCharacter.firstAppearance) {
      const beforeDialogues = dialogues;
      const beforeDescription = description;
      
      dialogues = dialogues.replace(/\bМУЖЧИНА\b/g, maleCharacter.name);
      dialogues = dialogues.replace(/\bПАРЕНЬ\b/g, maleCharacter.name);
      description = description.replace(/\bмужчина\b/gi, maleCharacter.fullName.toLowerCase());
      description = description.replace(/\bпарень\b/gi, maleCharacter.fullName.toLowerCase());
      
      if (dialogues !== beforeDialogues || description !== beforeDescription) {
        modified = true;
        replacements++;
      }
    }
    
    if (modified) {
      entryClone.dialogues = dialogues;
      entryClone.description = description;
    }
    
    return entryClone;
  });
  
  // Предупреждения о placeholder-ах которые не удалось заменить
  const remainingUnknowns = findUnknownCharacters(updatedEntries);
  if (remainingUnknowns.length > 0) {
    warnings.push(`⚠️ Осталось ${remainingUnknowns.length} неидентифицированных персонажей`);
    
    // Группируем по placeholder
    const byPlaceholder = new Map<string, number>();
    for (const u of remainingUnknowns) {
      byPlaceholder.set(u.placeholder, (byPlaceholder.get(u.placeholder) || 0) + 1);
    }
    
    byPlaceholder.forEach((count, placeholder) => {
      warnings.push(`   - ${placeholder}: ${count} упоминаний`);
    });
  }
  
  return { entries: updatedEntries, replacements, warnings };
}

/**
 * Главная функция: полный post-processing персонажей
 */
export function processCharacters(entries: any[]): CharacterProcessingResult {
  console.log(`\n🎭 Starting character post-processing for ${entries.length} entries...`);
  
  // 1. Извлекаем персонажей из титров
  const characters = extractCharactersFromTitles(entries);
  console.log(`   Found ${characters.length} characters in titles:`);
  for (const char of characters) {
    console.log(`   - ${char.name} (${char.fullName}) by ${char.actor || 'unknown'} at plan ${char.firstAppearance}`);
  }
  
  // 2. Заменяем placeholder-ы
  const { entries: updatedEntries, replacements, warnings } = replaceUnknownCharacters(entries, characters);
  console.log(`   Made ${replacements} replacements`);
  
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.log(`   ${warning}`);
    }
  }
  
  return {
    characters,
    replacements,
    warnings,
  };
}



