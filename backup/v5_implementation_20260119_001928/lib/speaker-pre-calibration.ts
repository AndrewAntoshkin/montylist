/**
 * Speaker Pre-Calibration — определение персонажей ДО обработки чанков
 * 
 * Анализирует FULL diarization и ищет явные упоминания имён:
 * - "Галя!" → следующий спикер = ГАЛИНА
 * - "Юсефчик" → текущий или следующий = ЮСЕФ
 * - "Танька" → ТАТЬЯНА
 */

export interface PreCalibrationResult {
  speakerToCharacter: Map<string, string>;  // A → ГАЛИНА
  confidence: Map<string, number>;          // A → 0.95
  evidence: Map<string, string[]>;          // A → ["mentioned as Галя", "replies after 'Галь!'"]
}

/**
 * Предварительная калибровка спикеров на основе упоминаний имён
 */
export function preCalibrateFromMentions(
  words: Array<{ text: string; speaker: string; start: number; end: number }>,
  characters: Array<{ 
    name: string; 
    normalizedName: string;
    variants: string[];
    gender?: string;
  }>
): PreCalibrationResult {
  const speakerToCharacter = new Map<string, string>();
  const confidence = new Map<string, number>();
  const evidence = new Map<string, string[]>();

  console.log(`\n🎯 PRE-CALIBRATION: Analyzing ${words.length} words for name mentions...`);
  console.log(`   Characters: ${characters.length}`);

  // Создаём карту вариантов имён → персонаж
  const variantMap = new Map<string, string>();
  for (const char of characters) {
    for (const variant of char.variants) {
      variantMap.set(variant.toLowerCase(), char.normalizedName);
    }
    // Добавляем базовые формы: Галя → Галь, Галюсь, Галечка
    const baseName = char.normalizedName.toLowerCase();
    variantMap.set(baseName, char.normalizedName);
    // Уменьшительные формы
    if (baseName.endsWith('а') || baseName.endsWith('я')) {
      variantMap.set(baseName.slice(0, -1), char.normalizedName); // Галя → Галь
      variantMap.set(baseName.slice(0, -1) + 'ь', char.normalizedName);
    }
  }

  // Проходим по всем словам
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = words[i + 1];
    const prevWord = words[i - 1];
    
    // Пропускаем слова без текста
    if (!word?.text) continue;
    
    const text = word.text.toLowerCase()
      .replace(/[!?,.\-—]/g, '') // Убираем пунктуацию
      .trim();

    // Ищем упоминание персонажа
    for (const [variant, charName] of variantMap.entries()) {
      if (text === variant || text.includes(variant)) {
        
        // СЛУЧАЙ 1: Обращение → следующий спикер
        // "Галя!" (speaker A) → следующий speaker B = ГАЛИНА
        if (nextWord && nextWord.speaker !== word.speaker) {
          const targetSpeaker = nextWord.speaker;
          
          if (!speakerToCharacter.has(targetSpeaker) || 
              (confidence.get(targetSpeaker) || 0) < 0.7) {
            speakerToCharacter.set(targetSpeaker, charName);
            confidence.set(targetSpeaker, 0.8);
            
            const evidenceList = evidence.get(targetSpeaker) || [];
            evidenceList.push(`mentioned as "${word.text}" by ${word.speaker}`);
            evidence.set(targetSpeaker, evidenceList);
            
            console.log(`   🎯 ${targetSpeaker} → ${charName} (mentioned as "${word.text}")`);
          }
        }
        
        // СЛУЧАЙ 2: Самоупоминание → текущий спикер
        // "Я Галя" (speaker A) → A = ГАЛИНА
        if (prevWord && 
            (prevWord.text.toLowerCase().includes('я') || 
             prevWord.text.toLowerCase().includes('меня'))) {
          const targetSpeaker = word.speaker;
          
          if (!speakerToCharacter.has(targetSpeaker)) {
            speakerToCharacter.set(targetSpeaker, charName);
            confidence.set(targetSpeaker, 0.9);
            
            const evidenceList = evidence.get(targetSpeaker) || [];
            evidenceList.push(`self-mentioned: "я ${word.text}"`);
            evidence.set(targetSpeaker, evidenceList);
            
            console.log(`   🎯 ${targetSpeaker} → ${charName} (self: "${prevWord.text} ${word.text}")`);
          }
        }
      }
    }
  }

  console.log(`\n📊 Pre-calibration results:`);
  console.log(`   Speakers mapped: ${speakerToCharacter.size}/${new Set(words.map(w => w.speaker)).size}`);
  
  for (const [speaker, char] of speakerToCharacter.entries()) {
    const conf = confidence.get(speaker) || 0;
    const ev = evidence.get(speaker) || [];
    console.log(`   ✅ ${speaker} → ${char} (confidence: ${(conf * 100).toFixed(0)}%, evidence: ${ev.length})`);
  }

  return {
    speakerToCharacter,
    confidence,
    evidence,
  };
}

/**
 * Применяет pre-calibration к начальной карте спикеров
 */
export function applyPreCalibration(
  existingMapping: Map<string, string>,
  preCalibration: PreCalibrationResult
): Map<string, string> {
  const combined = new Map(existingMapping);
  
  for (const [speaker, character] of preCalibration.speakerToCharacter.entries()) {
    const conf = preCalibration.confidence.get(speaker) || 0;
    
    // Применяем если уверенность >70% ИЛИ спикер ещё не откалиброван
    if (conf >= 0.7 || !combined.has(speaker)) {
      combined.set(speaker, character);
    }
  }
  
  return combined;
}
