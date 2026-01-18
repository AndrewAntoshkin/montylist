/**
 * Character Registry — накопительный реестр имён персонажей
 * 
 * Строгие правила:
 * - Имена добавляются только из ПОДТВЕРЖДЁННЫХ источников
 * - Не угадываем: если не уверены → НЕИЗВЕСТНЫЙ_ГОЛОС_N
 * - Передаём в каждый следующий чанк
 */

export interface RegisteredCharacter {
  name: string;                    // Каноническое имя (ГАЛЯ)
  variants: string[];              // Варианты (Галина, Галюся)
  gender: 'male' | 'female' | 'unknown';
  source: 'title' | 'dialogue' | 'address' | 'description';
  confidence: 'high' | 'medium' | 'low';
  firstSeenChunk: number;
  actor?: string;                  // Имя актёра если известно
}

export interface CharacterRegistry {
  characters: RegisteredCharacter[];
  unknownVoices: number;           // Счётчик для НЕИЗВЕСТНЫЙ_ГОЛОС_N
  lastUpdatedChunk: number;
}

/**
 * Создаёт пустой реестр
 */
export function createEmptyRegistry(): CharacterRegistry {
  return {
    characters: [],
    unknownVoices: 0,
    lastUpdatedChunk: -1,
  };
}

/**
 * Добавляет персонажа в реестр (с дедупликацией)
 */
export function addCharacterToRegistry(
  registry: CharacterRegistry,
  name: string,
  options: {
    variants?: string[];
    gender?: 'male' | 'female' | 'unknown';
    source: 'title' | 'dialogue' | 'address' | 'description';
    confidence?: 'high' | 'medium' | 'low';
    chunkIndex: number;
    actor?: string;
  }
): boolean {
  const canonicalName = normalizeCharacterName(name);
  
  // Проверяем валидность имени
  if (!isValidCharacterName(canonicalName)) {
    return false;
  }
  
  // Проверяем дубликат
  const existing = registry.characters.find(c => 
    c.name === canonicalName || 
    c.variants.includes(canonicalName) ||
    c.name === name.toUpperCase()
  );
  
  if (existing) {
    // Обновляем варианты если нужно
    if (!existing.variants.includes(name.toUpperCase()) && name.toUpperCase() !== existing.name) {
      existing.variants.push(name.toUpperCase());
    }
    // Повышаем confidence если новый источник надёжнее
    if (options.source === 'title' && existing.confidence !== 'high') {
      existing.confidence = 'high';
    }
    if (options.actor && !existing.actor) {
      existing.actor = options.actor;
    }
    return false;
  }
  
  // Добавляем новый
  registry.characters.push({
    name: canonicalName,
    variants: [name.toUpperCase()].filter(v => v !== canonicalName),
    gender: options.gender || guessGender(canonicalName),
    source: options.source,
    confidence: options.confidence || (options.source === 'title' ? 'high' : 'medium'),
    firstSeenChunk: options.chunkIndex,
    actor: options.actor,
  });
  
  registry.lastUpdatedChunk = options.chunkIndex;
  return true;
}

/**
 * Получает следующий ID для неизвестного голоса
 */
export function getNextUnknownVoiceId(registry: CharacterRegistry): string {
  registry.unknownVoices++;
  return `НЕИЗВЕСТНЫЙ_ГОЛОС_${registry.unknownVoices}`;
}

/**
 * Форматирует реестр для промпта Gemini
 */
export function formatRegistryForPrompt(registry: CharacterRegistry): string {
  if (registry.characters.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('🎭 РЕЕСТР ПЕРСОНАЖЕЙ (СТРОГО ИСПОЛЬЗОВАТЬ ЭТИ ИМЕНА!)');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Сортируем по уверенности
  const sorted = [...registry.characters].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });
  
  for (const char of sorted) {
    let line = `• ${char.name}`;
    if (char.actor) {
      line += ` (актёр: ${char.actor})`;
    }
    if (char.variants.length > 0) {
      line += ` [варианты: ${char.variants.join(', ')}]`;
    }
    line += ` — ${char.gender === 'female' ? 'Ж' : char.gender === 'male' ? 'М' : '?'}`;
    lines.push(line);
  }
  
  lines.push('');
  lines.push('⚠️ ПРАВИЛА:');
  lines.push('1. Используй ТОЛЬКО имена из списка выше');
  lines.push('2. НЕ пиши "МУЖЧИНА", "ЖЕНЩИНА", "ДЕВУШКА" если персонаж известен');
  lines.push('3. Если не уверен кто говорит → пиши "НЕИЗВЕСТНЫЙ_ГОЛОС"');
  lines.push('4. НЕ придумывай новые имена!');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Извлекает имена из обработанных планов и добавляет в реестр
 */
export function extractAndAddToRegistry(
  registry: CharacterRegistry,
  entries: Array<{ description?: string; dialogues?: string }>,
  chunkIndex: number
): { added: string[]; existing: string[] } {
  const added: string[] = [];
  const existing: string[] = [];
  
  for (const entry of entries) {
    // 1. Извлекаем спикеров из диалогов
    const dialogues = entry.dialogues || '';
    // Supports:
    // - ГАЛЯ
    // - ГАЛЯ ЗК / ГАЛЯ ГЗ
    // - ГАЛЯ (ЗК) / ГАЛЯ (ГЗ) (модели часто так пишут)
    const speakerPattern = /^([А-ЯЁ]+)(?:\s*(?:(?:ЗК|ГЗ)|\((?:ЗК|ГЗ)\)))?\s*$/gm;
    
    let match;
    while ((match = speakerPattern.exec(dialogues)) !== null) {
      const name = match[1].replace(/\s*(ЗК|ГЗ)$/, '').trim();
      
      if (isValidCharacterName(name)) {
        const wasAdded = addCharacterToRegistry(registry, name, {
          source: 'dialogue',
          chunkIndex,
        });
        
        if (wasAdded) {
          added.push(name);
        } else {
          existing.push(name);
        }
      }
    }
    
    // 2. Извлекаем из титров
    const description = entry.description || '';
    const titlePatterns = [
      /[Тт]итр[:\s]*[«"]?([А-ЯЁа-яё]+)[»"]?\s*[-–—.]\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/g,
      /[«"]([А-ЯЁа-яё]+)\.\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)[»"]/g,
    ];
    
    for (const pattern of titlePatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1].trim();
        const actor = match[2]?.trim();
        
        if (isValidCharacterName(name)) {
          const wasAdded = addCharacterToRegistry(registry, name, {
            source: 'title',
            confidence: 'high',
            chunkIndex,
            actor,
          });
          
          if (wasAdded) {
            added.push(name);
          }
        }
      }
    }
  }
  
  return { added, existing };
}

/**
 * Нормализует имя персонажа
 */
function normalizeCharacterName(name: string): string {
  let normalized = name.toUpperCase().trim();
  
  // Убираем ЗК/ГЗ
  normalized = normalized.replace(/\s*(ЗК|ГЗ)$/, '');
  
  // Словарь сокращений
  const shortNames: Record<string, string> = {
    'ГАЛИНА': 'ГАЛЯ',
    'ТАТЬЯНА': 'ТАНЯ',
    'НАТАЛЬЯ': 'НАТАША',
    'ЕКАТЕРИНА': 'КАТЯ',
    'АЛЕКСАНДРА': 'САША',
    'АЛЕКСАНДР': 'САША',
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
  
  return shortNames[normalized] || normalized;
}

/**
 * Проверяет валидность имени персонажа
 */
function isValidCharacterName(name: string): boolean {
  const upper = name.toUpperCase().trim();
  
  // Слишком короткое
  if (upper.length < 3) return false;
  
  // Технические слова
  const excludeWords = new Set([
    'РЕЖИССЕР', 'РЕЖИССЁР', 'ПРОДЮСЕР', 'ОПЕРАТОР', 'СЦЕНАРИЙ', 'АВТОР',
    'МУЗЫКА', 'МОНТАЖ', 'ХУДОЖНИК', 'ЗВУК', 'ДИРЕКТОР', 'КРЕАТИВНЫЙ',
    'ТЕЛЕКОМПАНИЯ', 'ПАРТНЕР', 'ПАРТНЁР', 'ФИЛЬМ', 'СЕРИАЛ', 'ПОСТАНОВЩИК',
    'ИСПОЛНИТЕЛЬНЫЙ', 'ГЛАВНЫЙ', 'ВЕДУЩИЙ', 'ПРЕДСТАВЛЯЕТ', 'ТИТР',
    'МУЖЧИНА', 'ЖЕНЩИНА', 'ДЕВУШКА', 'ПАРЕНЬ', 'ЧЕЛОВЕК', 'ГОЛОС',
    'КЛИЕНТ', 'КЛИЕНТКА', 'ГОСТЬ', 'ПОСЕТИТЕЛЬ', 'ПРОХОЖИЙ', 'РЕБЁНОК',
    // Unknown markers
    'НЕИЗВЕСТНАЯ', 'НЕИЗВЕСТНЫЙ', 'НЕИЗВЕСТНЫЙ_ГОЛОС', 'НЕИЗВЕСТНЫЙ ГОЛОС',
    // Common role/profession labels (should stay as roles, not become "known character names")
    'ОФИЦИАНТ', 'ОФИЦИАНТКА', 'ПОЛИЦЕЙСКИЙ', 'ОХРАННИК', 'ПРОДАВЕЦ',
    'ВРАЧ', 'МЕДСЕСТРА', 'АДМИНИСТРАТОР', 'КУРЬЕР', 'ВОДИТЕЛЬ',
    // Common appearance/nationality labels frequently hallucinated as names
    'БЛОНДИНКА', 'РЫЖАЯ', 'БРЮНЕТ', 'БРЮНЕТКА',
    'АРАБ', 'КАЗАК', 'МЕКСИКАНЕЦ',
    // Generic workplace labels
    'СОТРУДНИЦА', 'СОТРУДНИК',
  ]);
  
  return !excludeWords.has(upper);
}

/**
 * Угадывает пол по имени
 */
function guessGender(name: string): 'male' | 'female' | 'unknown' {
  const femaleNames = new Set([
    'ШУРОЧКА', 'БЭЛЛА', 'БЕЛЛА', 'ТОМА', 'СВЕТИК', 'ВАРВАРА', 'СЮЗАННА',
    'НАДЕЖДА', 'ЛЮДАСЯ', 'ГАЛЯ', 'ЛАРИСА', 'СВЕТА', 'ВАЛЯ', 'ЛЕНА', 'ЗИНА',
    'ТАНЯ', 'АННА', 'МАРИЯ', 'МАРИНА', 'НАТАША', 'КАТЯ', 'НАСТЯ', 'ОЛЯ',
    'ЛЮДА', 'МАША', 'ЛЮБА', 'ИРИНА', 'ОКСАНА', 'ЮЛИЯ', 'ВЕРА', 'НАДЯ',
  ]);
  
  const maleNames = new Set([
    'ЮСЕФ', 'МОХАММЕД', 'ИОСИФ', 'САША', 'ДИМА', 'ВОВА', 'ЖЕНЯ', 'КОЛЯ',
    'МИША', 'ОЛЕГ', 'ИГОРЬ', 'СЕРГЕЙ', 'АНДРЕЙ', 'ПАВЕЛ', 'ВИТАЛИК',
    'ВОВЧИК', 'ТОЛИК', 'ПЕТЯ', 'ВИТЯ', 'КОСТЯ', 'АНТОН', 'МАКСИМ',
  ]);
  
  const upper = name.toUpperCase();
  
  if (femaleNames.has(upper)) return 'female';
  if (maleNames.has(upper)) return 'male';
  
  // Эвристика: -А, -Я обычно женские
  if (upper.endsWith('А') || upper.endsWith('Я')) return 'female';
  
  return 'unknown';
}

/**
 * Проверяет использование неизвестных имён в entries
 */
export function validateCharacterUsage(
  registry: CharacterRegistry,
  entries: Array<{ dialogues?: string }>
): {
  unknownNames: string[];
  genericNames: string[];
  suggestions: string[];
} {
  const unknownNames: string[] = [];
  const genericNames: string[] = [];
  const suggestions: string[] = [];
  
  const knownNames = new Set(registry.characters.flatMap(c => [c.name, ...c.variants]));
  const genericSet = new Set(['МУЖЧИНА', 'ЖЕНЩИНА', 'ДЕВУШКА', 'ПАРЕНЬ', 'ЧЕЛОВЕК']);
  
  for (const entry of entries) {
    const dialogues = entry.dialogues || '';
    const speakerPattern = /^([А-ЯЁ]+(?:\s+(?:ЗК|ГЗ))?)\s*$/gm;
    
    let match;
    while ((match = speakerPattern.exec(dialogues)) !== null) {
      const speaker = match[1].replace(/\s*(ЗК|ГЗ)$/, '').trim();
      
      if (genericSet.has(speaker)) {
        genericNames.push(speaker);
      } else if (!knownNames.has(speaker) && isValidCharacterName(speaker)) {
        unknownNames.push(speaker);
      }
    }
  }
  
  // Генерируем suggestions
  if (genericNames.length > 0) {
    suggestions.push(`⚠️ Используются generic имена (${[...new Set(genericNames)].join(', ')}) — замените на реальные персонажи`);
  }
  
  if (unknownNames.length > 0) {
    suggestions.push(`⚠️ Найдены неизвестные имена (${[...new Set(unknownNames)].join(', ')}) — добавьте в реестр или проверьте орфографию`);
  }
  
  return {
    unknownNames: [...new Set(unknownNames)],
    genericNames: [...new Set(genericNames)],
    suggestions,
  };
}



