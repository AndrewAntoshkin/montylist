/**
 * CharacterTracker - отслеживает персонажей между чанками обработки
 * 
 * Цели:
 * 1. Хранить персонажей из сценария с описаниями
 * 2. Отслеживать "новых" персонажей, которых Gemini обнаружил в видео
 * 3. Накапливать контекст для улучшения атрибуции
 * 4. Не путать новых персонажей с главными героями
 */

export interface ScriptCharacter {
  name: string;
  normalizedName: string;
  description?: string;
  gender?: 'male' | 'female' | 'unknown';
  dialogueCount: number;
}

export interface DiscoveredCharacter {
  name: string;                    // Как Gemini назвал: "Зина", "Жена Юсефа"
  firstSeenTimecode: string;       // Когда впервые появился
  firstSeenChunk: number;          // В каком чанке
  context: string;                 // Контекст: "рисует хной", "сидит за столом"
  appearances: number;             // Сколько раз упоминался
  possibleScriptMatch?: string;    // Возможное соответствие из сценария
  isGenericTerm: boolean;          // "Женщина", "Мужчина" — generic
}

export interface SpeakerAttribution {
  timecode: string;
  speaker: string;
  text: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'gemini' | 'whisper' | 'inherited' | 'fallback';
}

export class CharacterTracker {
  private scriptCharacters: Map<string, ScriptCharacter> = new Map();
  private discoveredCharacters: Map<string, DiscoveredCharacter> = new Map();
  private speakerHistory: SpeakerAttribution[] = [];
  private lastSpeaker: string | null = null;
  private currentChunk: number = 0;

  // Generic terms to track (professions, roles)
  private static GENERIC_TERMS = [
    'ЖЕНЩИНА', 'ДЕВУШКА', 'БЛОНДИНКА', 'БРЮНЕТКА',
    'МУЖЧИНА', 'ПАРЕНЬ', 'АРАБ', 
    'ЖЕНА', 'МУЖ', 'КЛИЕНТКА', 'КЛИЕНТ',
    'ОФИЦИАНТКА', 'КОСМЕТОЛОГ', 'МЕНЕДЖЕР'
  ];

  // Стоп-слова — это НЕ имена персонажей
  private static NOT_NAMES = [
    // Наречия и прилагательные
    'ЗАДУМЧИВО', 'ВНИМАТЕЛЬНО', 'РАДОСТНО', 'ГРУСТНО', 'ВЕСЕЛО', 'СЕРЬЁЗНО',
    'ПРОДОЛЖАЕТ', 'РЕШИТЕЛЬНО', 'СПОКОЙНО', 'НЕРВНО', 'МЕДЛЕННО', 'БЫСТРО',
    'ИСПУГАННО', 'УДИВЛЁННО', 'ВЗВОЛНОВАННО', 'ТИХО', 'ГРОМКО', 'ШЁПОТОМ',
    // Действия
    'ГОВОРИТ', 'СМОТРИТ', 'СЛУШАЕТ', 'ИДЁТ', 'СТОИТ', 'СИДИТ', 'ВХОДИТ',
    // Места и объекты
    'САЛОНЕ', 'КУХНЕ', 'КОМНАТЕ', 'КАБИНЕТЕ', 'ЗАЛЕ', 'РЕСТОРАНЕ',
    // Частые ошибки
    'МУЗЫКА', 'НЕИЗВЕСТНЫЙ', 'ФЛЕШБЭК', 'ТИТРЫ', 'ЛОГОТИП', 'ЗАСТАВКА',
    // Технические слова
    'УНИФОРМЕ', 'ПАРИКМАХЕР', 'МАНИКЮРША',
    // Частые слова из реплик (НЕ имена!)
    'ХОРОШО', 'ЛАДНО', 'ДАВАЙ', 'ПОЖАЛУЙСТА', 'СПАСИБО', 'ПРИВЕТ', 'ПОКА',
    'ПАРДОН', 'ИЗВИНИ', 'ИЗВИНИТЕ', 'ПРОСТИ', 'ПРОСТИТЕ', 'КОНЕЧНО',
    'ПОНЯТНО', 'ЯСНО', 'ТОЧНО', 'ВЕРНО', 'ПРАВДА', 'ПРАВИЛЬНО',
    // Еда и предметы (часто путают с именами)
    'ГРЕЧАНИКИ', 'ПОЧЕРЕВОК', 'ПЛАЦИНДА', 'ВАРЕНИКИ', 'БОРЩ', 'САЛО',
    'ГОРИЛКА', 'ВОДКА', 'МАСКА', 'ПОЛОТЕНЦЕ', 'БЛОКНОТ', 'МЕНЮ',
    // Междометия и восклицания
    'МИНУТОЧКУ', 'ПОДОЖДИ', 'СТОЙ', 'СМОТРИ', 'СЛУШАЙ', 'ПОГОДИ',
    // Частые ремарки
    'СМЕХ', 'ВЗДОХ', 'ПАУЗА', 'ТИШИНА', 'ШУМ', 'ЗВУК',
  ];

  constructor(scriptCharacters?: ScriptCharacter[]) {
    if (scriptCharacters) {
      this.loadScriptCharacters(scriptCharacters);
    }
  }

  /**
   * Загрузить персонажей из сценария
   */
  loadScriptCharacters(characters: ScriptCharacter[]): void {
    for (const char of characters) {
      // Сохраняем по оригинальному и нормализованному имени
      this.scriptCharacters.set(char.name.toUpperCase(), char);
      if (char.normalizedName && char.normalizedName !== char.name) {
        this.scriptCharacters.set(char.normalizedName.toUpperCase(), char);
      }
    }
    console.log(`📋 CharacterTracker: loaded ${this.scriptCharacters.size} script characters`);
  }

  /**
   * Получить список всех имён из сценария
   */
  getScriptNames(): string[] {
    const names = new Set<string>();
    for (const char of this.scriptCharacters.values()) {
      names.add(char.name);
      if (char.normalizedName) names.add(char.normalizedName);
    }
    return Array.from(names);
  }

  /**
   * Проверить, есть ли персонаж в сценарии
   */
  isScriptCharacter(name: string): boolean {
    return this.scriptCharacters.has(name.toUpperCase());
  }

  /**
   * Проверить, является ли имя generic термином
   */
  isGenericTerm(name: string): boolean {
    const upper = name.toUpperCase();
    return CharacterTracker.GENERIC_TERMS.some(term => 
      upper.includes(term) || term.includes(upper)
    );
  }

  /**
   * Обработать вывод Gemini и отследить новых персонажей
   */
  processGeminiOutput(
    scenes: Array<{ description: string; dialogues: string; start_timecode: string }>,
    chunkIndex: number
  ): void {
    this.currentChunk = chunkIndex;

    for (const scene of scenes) {
      // Извлекаем имена из диалогов
      const dialogueNames = this.extractNamesFromDialogues(scene.dialogues);
      
      // Извлекаем имена из описания
      const descriptionNames = this.extractNamesFromDescription(scene.description);
      
      const allNames = [...dialogueNames, ...descriptionNames];
      
      for (const name of allNames) {
        if (!name || name.length < 2) continue;
        
        const upperName = name.toUpperCase();
        
        // Если это персонаж из сценария — пропускаем
        if (this.isScriptCharacter(upperName)) {
          continue;
        }
        
        // Если это стоп-слово — пропускаем (не имя!)
        if (CharacterTracker.NOT_NAMES.includes(upperName)) {
          continue;
        }
        
        // Если имя слишком длинное (> 15 символов) — скорее всего это не имя
        if (upperName.length > 15) {
          continue;
        }
        
        // Если содержит цифры — не имя
        if (/\d/.test(upperName)) {
          continue;
        }
        
        // Это новый персонаж!
        const isGeneric = this.isGenericTerm(upperName);
        
        if (this.discoveredCharacters.has(upperName)) {
          // Уже видели — увеличиваем счётчик
          const existing = this.discoveredCharacters.get(upperName)!;
          existing.appearances++;
        } else {
          // Новый — добавляем
          this.discoveredCharacters.set(upperName, {
            name: upperName,
            firstSeenTimecode: scene.start_timecode,
            firstSeenChunk: chunkIndex,
            context: scene.description.substring(0, 100),
            appearances: 1,
            possibleScriptMatch: this.findPossibleMatch(upperName, scene.description),
            isGenericTerm: isGeneric,
          });
          
          if (!isGeneric) {
            console.log(`   🆕 New character discovered: ${upperName} at ${scene.start_timecode}`);
          }
        }
      }
    }
  }

  /**
   * Извлечь имена из диалогов (формат: ИМЯ\nтекст или ИМЯ ЗК\nтекст)
   * 
   * Формат Gemini:
   * ГАЛЯ
   * Привет!
   * ЮСЕФ
   * Здравствуй!
   */
  private extractNamesFromDialogues(dialogues: string): string[] {
    const names: string[] = [];
    if (!dialogues || dialogues.toLowerCase() === 'музыка') {
      return names;
    }
    
    const lines = dialogues.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Пропускаем пустые строки и текст реплик (начинаются с маленькой буквы или знака)
      if (!trimmed || /^[a-zа-яё\(\[\"\']/.test(trimmed)) {
        continue;
      }
      
      // Имя спикера: только заглавные буквы, может быть "ИМЯ ЗК" или "ИМЯ ГЗ"
      // Максимум 2 слова (имя + ЗК/ГЗ)
      const nameMatch = trimmed.match(/^([А-ЯЁ][А-ЯЁа-яё]+)(?:\s+(ЗК|ГЗ))?$/);
      
      if (nameMatch) {
        const name = nameMatch[1];
        
        // Имя должно быть 2-12 символов (не "Я", не "ЗАДУМЧИВО")
        if (name.length >= 2 && name.length <= 12) {
          // Пропускаем стоп-слова
          if (!CharacterTracker.NOT_NAMES.includes(name.toUpperCase())) {
            names.push(name);
          }
        }
      }
    }
    
    return names;
  }

  /**
   * Извлечь имена персонажей из описания сцены
   */
  private extractNamesFromDescription(description: string): string[] {
    const names: string[] = [];
    
    // Ищем имена с заглавной буквы в контексте действия
    // "Галя идет", "Юсеф смотрит", "Жена (Зина) рисует"
    const patterns = [
      /([А-ЯЁ][а-яё]+)\s+(?:идет|стоит|сидит|смотрит|говорит|слушает|входит)/gi,
      /([А-ЯЁ][а-яё]+)\s+в\s+кадре/gi,
      /\(([А-ЯЁ][а-яё]+)\)/gi, // В скобках: (Зина)
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        names.push(match[1]);
      }
    }
    
    return names;
  }

  /**
   * Попытаться найти соответствие новому персонажу в сценарии
   */
  private findPossibleMatch(newName: string, context: string): string | undefined {
    const contextLower = context.toLowerCase();
    const newNameLower = newName.toLowerCase();
    
    // Если это generic "Женщина" — ищем главную женскую роль
    if (this.isGenericTerm(newName)) {
      // Находим персонажа с наибольшим количеством реплик нужного пола
      const isFemale = ['женщин', 'девушк', 'блондинк', 'жена', 'клиентк', 'официантк', 'косметолог']
        .some(term => newNameLower.includes(term));
      
      const gender = isFemale ? 'female' : 'male';
      
      let bestMatch: ScriptCharacter | undefined;
      for (const char of this.scriptCharacters.values()) {
        if (char.gender === gender) {
          if (!bestMatch || char.dialogueCount > bestMatch.dialogueCount) {
            bestMatch = char;
          }
        }
      }
      
      return bestMatch?.name;
    }
    
    // Ищем похожие имена в сценарии
    for (const char of this.scriptCharacters.values()) {
      if (char.name.toLowerCase().includes(newNameLower) ||
          newNameLower.includes(char.name.toLowerCase())) {
        return char.name;
      }
    }
    
    return undefined;
  }

  /**
   * Получить рекомендуемое имя для generic термина
   */
  resolveGenericTerm(genericName: string, description: string): string | null {
    const discovered = this.discoveredCharacters.get(genericName.toUpperCase());
    
    if (discovered?.possibleScriptMatch) {
      return discovered.possibleScriptMatch;
    }
    
    // Fallback: ищем по полу
    return this.findPossibleMatch(genericName, description) || null;
  }

  /**
   * Записать атрибуцию спикера
   */
  recordSpeaker(attribution: SpeakerAttribution): void {
    this.speakerHistory.push(attribution);
    
    // Обновляем lastSpeaker если это не ЗК
    if (!attribution.speaker.includes('ЗК') && !attribution.speaker.includes('ГЗ')) {
      this.lastSpeaker = attribution.speaker;
    }
  }

  /**
   * Получить последнего известного спикера
   */
  getLastSpeaker(): string | null {
    return this.lastSpeaker;
  }

  /**
   * Установить последнего спикера
   */
  setLastSpeaker(speaker: string | null): void {
    this.lastSpeaker = speaker;
  }

  /**
   * Получить контекст для промпта Gemini
   */
  getContextForPrompt(): string {
    const lines: string[] = [];
    
    // Информация о "новых" персонажах
    const nonGenericDiscovered = Array.from(this.discoveredCharacters.values())
      .filter(c => !c.isGenericTerm && c.appearances >= 2);
    
    if (nonGenericDiscovered.length > 0) {
      lines.push('');
      lines.push('📌 РАНЕЕ ОБНАРУЖЕННЫЕ ПЕРСОНАЖИ (НЕ из сценария):');
      for (const char of nonGenericDiscovered.slice(0, 5)) {
        let line = `   • ${char.name} — впервые в ${char.firstSeenTimecode}`;
        if (char.possibleScriptMatch) {
          line += ` (возможно это ${char.possibleScriptMatch})`;
        }
        lines.push(line);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Получить статистику
   */
  getStats(): { 
    scriptCharacters: number; 
    discoveredCharacters: number;
    genericTermsUsed: number;
  } {
    const discovered = Array.from(this.discoveredCharacters.values());
    return {
      scriptCharacters: this.scriptCharacters.size,
      discoveredCharacters: discovered.filter(c => !c.isGenericTerm).length,
      genericTermsUsed: discovered.filter(c => c.isGenericTerm).length,
    };
  }

  /**
   * Экспорт состояния для сохранения между чанками
   */
  exportState(): string {
    return JSON.stringify({
      discoveredCharacters: Array.from(this.discoveredCharacters.entries()),
      lastSpeaker: this.lastSpeaker,
      currentChunk: this.currentChunk,
    });
  }

  /**
   * Импорт состояния
   */
  importState(stateJson: string): void {
    try {
      const state = JSON.parse(stateJson);
      this.discoveredCharacters = new Map(state.discoveredCharacters);
      this.lastSpeaker = state.lastSpeaker;
      this.currentChunk = state.currentChunk;
    } catch (e) {
      console.warn('Failed to import CharacterTracker state:', e);
    }
  }
}

/**
 * Глобальный кэш трекеров по videoId
 */
const trackerCache = new Map<string, CharacterTracker>();

export function getOrCreateTracker(videoId: string, scriptCharacters?: ScriptCharacter[]): CharacterTracker {
  if (!trackerCache.has(videoId)) {
    const tracker = new CharacterTracker(scriptCharacters);
    trackerCache.set(videoId, tracker);
  }
  return trackerCache.get(videoId)!;
}

export function clearTracker(videoId: string): void {
  trackerCache.delete(videoId);
}

