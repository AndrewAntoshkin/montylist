/**
 * Face-Speaker Binding Module
 * 
 * Связывает кластеры лиц с персонажами через анализ diarization данных.
 * "Лицо + Голос = Персонаж"
 * 
 * @author AI Assistant
 * @date 2026-01-16
 */

// Import types from separate file to avoid loading face-api.js
import type { 
  FaceCluster, 
  DiarizedWord, 
  SpeakerBinding, 
  SceneCharacterInfo,
  Character,
  FullCalibrationResult
} from './face-types';

// Re-export types for convenience
export type { 
  DiarizedWord, 
  SpeakerBinding, 
  SceneCharacterInfo, 
  Character, 
  FullCalibrationResult,
  FaceCluster 
};

// ═══════════════════════════════════════════════════════════════════════════
// Локальные интерфейсы удалены — используем из face-types.ts
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// СВЯЗЫВАНИЕ ЧЕРЕЗ ВРЕМЕННЫЕ СОВПАДЕНИЯ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Связывает кластеры лиц с персонажами через временные совпадения
 * 
 * Логика:
 * 1. Для каждого кластера лиц смотрим, когда он появляется
 * 2. Находим слова из diarization в этих временных окнах
 * 3. Подсчитываем, какой speaker чаще всего говорит когда это лицо в кадре
 * 4. Связываем лицо с этим speaker
 * 
 * @param faceClusters - Кластеры лиц из face-clustering
 * @param diarizationWords - Слова из AssemblyAI diarization
 * @param speakerToCharacter - Mapping speaker → персонаж (из pre-calibration)
 * @param windowSeconds - Окно совпадения в секундах (±)
 */
export function bindFacesToSpeakers(
  faceClusters: FaceCluster[],
  diarizationWords: DiarizedWord[],
  speakerToCharacter: Map<string, string>,
  windowSeconds: number = 2.0
): Map<string, string> {
  
  console.log('\n' + '═'.repeat(60));
  console.log('🔗 BINDING FACES TO CHARACTERS');
  console.log('═'.repeat(60));
  console.log(`   Clusters: ${faceClusters.length}`);
  console.log(`   Words: ${diarizationWords.length}`);
  console.log(`   Known speakers: ${speakerToCharacter.size}`);
  console.log(`   Window: ±${windowSeconds}s`);
  console.log('');
  
  const faceToCharacter = new Map<string, string>();
  const bindings: SpeakerBinding[] = [];
  
  for (const cluster of faceClusters) {
    // Подсчитываем голоса спикеров для этого лица
    const speakerVotes = new Map<string, number>();
    
    for (const face of cluster.faces) {
      // Переводим timestamp лица в мс
      const faceTimeMs = face.timestamp * 1000;
      
      // Находим слова в окне ±windowSeconds
      const wordsNearby = diarizationWords.filter(w => {
        const wordMidpoint = (w.start + w.end) / 2;
        return Math.abs(wordMidpoint - faceTimeMs) < windowSeconds * 1000;
      });
      
      // Голосуем за спикера
      for (const word of wordsNearby) {
        speakerVotes.set(
          word.speaker,
          (speakerVotes.get(word.speaker) || 0) + 1
        );
      }
    }
    
    // Находим топ спикера
    const sortedVotes = Array.from(speakerVotes.entries())
      .sort((a, b) => b[1] - a[1]);
    
    if (sortedVotes.length === 0) {
      console.log(`   ⚠️  ${cluster.clusterId}: No speaker matches (${cluster.appearances} appearances)`);
      continue;
    }
    
    const [topSpeaker, topVotes] = sortedVotes[0];
    const totalVotes = sortedVotes.reduce((sum, [, v]) => sum + v, 0);
    const confidence = topVotes / totalVotes;
    
    // Проверяем: есть ли этот speaker в mapping?
    const character = speakerToCharacter.get(topSpeaker);
    
    if (character && confidence >= 0.4) {
      // Успешная привязка
      faceToCharacter.set(cluster.clusterId, character);
      cluster.characterName = character;
      
      bindings.push({
        clusterId: cluster.clusterId,
        speakerId: topSpeaker,
        characterName: character,
        confidence,
        matchedWords: topVotes,
        method: 'temporal'
      });
      
      console.log(`   ✅ ${cluster.clusterId} → ${character} (speaker ${topSpeaker}, ${topVotes} words, ${(confidence * 100).toFixed(0)}% confidence)`);
    } else if (character) {
      console.log(`   ⚠️  ${cluster.clusterId} → ${character}? (low confidence: ${(confidence * 100).toFixed(0)}%)`);
    } else {
      console.log(`   ⚠️  ${cluster.clusterId} → Speaker ${topSpeaker} (not calibrated yet)`);
    }
  }
  
  console.log('');
  console.log(`✅ Successfully bound ${faceToCharacter.size}/${faceClusters.length} face clusters`);
  console.log('═'.repeat(60) + '\n');
  
  return faceToCharacter;
}

// ═══════════════════════════════════════════════════════════════════════════
// ОБРАТНАЯ КАЛИБРОВКА: ЛИЦО → SPEAKER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Обратная калибровка: если знаем лицо персонажа, можем определить его speaker
 * 
 * Полезно когда:
 * - Лицо известно (из титров или ручной разметки)
 * - Speaker ещё не откалиброван
 * 
 * @param faceClusters - Кластеры с characterName
 * @param diarizationWords - Слова из diarization
 * @param windowSeconds - Окно совпадения
 */
export function calibrateSpeakersFromFaces(
  faceClusters: FaceCluster[],
  diarizationWords: DiarizedWord[],
  windowSeconds: number = 2.0
): Map<string, string> {
  
  console.log('\n🔄 REVERSE CALIBRATION: Face → Speaker');
  
  const speakerToCharacter = new Map<string, string>();
  
  // Только кластеры с известным characterName
  const knownClusters = faceClusters.filter(c => c.characterName);
  
  for (const cluster of knownClusters) {
    const speakerVotes = new Map<string, number>();
    
    for (const face of cluster.faces) {
      const faceTimeMs = face.timestamp * 1000;
      
      const wordsNearby = diarizationWords.filter(w => {
        const wordMidpoint = (w.start + w.end) / 2;
        return Math.abs(wordMidpoint - faceTimeMs) < windowSeconds * 1000;
      });
      
      for (const word of wordsNearby) {
        speakerVotes.set(
          word.speaker,
          (speakerVotes.get(word.speaker) || 0) + 1
        );
      }
    }
    
    const sortedVotes = Array.from(speakerVotes.entries())
      .sort((a, b) => b[1] - a[1]);
    
    if (sortedVotes.length > 0) {
      const [topSpeaker, topVotes] = sortedVotes[0];
      const totalVotes = sortedVotes.reduce((sum, [, v]) => sum + v, 0);
      const confidence = topVotes / totalVotes;
      
      if (confidence >= 0.5) {
        speakerToCharacter.set(topSpeaker, cluster.characterName!);
        console.log(`   ✅ Speaker ${topSpeaker} → ${cluster.characterName} (${topVotes} matches, ${(confidence * 100).toFixed(0)}%)`);
      }
    }
  }
  
  console.log(`   📊 Calibrated ${speakerToCharacter.size} speakers from faces\n`);
  
  return speakerToCharacter;
}

// ═══════════════════════════════════════════════════════════════════════════
// ОПРЕДЕЛЕНИЕ ПЕРСОНАЖА В СЦЕНЕ
// ═══════════════════════════════════════════════════════════════════════════

// SceneCharacterInfo interface is imported from face-types.ts

/**
 * Определяет персонажей в сцене по лицам и голосу
 * 
 * @param sceneStartMs - Начало сцены в мс
 * @param sceneEndMs - Конец сцены в мс
 * @param faceClusters - Кластеры с characterName
 * @param diarizationWords - Слова из diarization
 * @param speakerToCharacter - Mapping speaker → character
 */
export function determineSceneCharacters(
  sceneStartMs: number,
  sceneEndMs: number,
  faceClusters: FaceCluster[],
  diarizationWords: DiarizedWord[],
  speakerToCharacter: Map<string, string>
): SceneCharacterInfo {
  
  // 1. Определяем какие лица появляются в этом временном окне
  const sceneStartSec = sceneStartMs / 1000;
  const sceneEndSec = sceneEndMs / 1000;
  
  const facesInFrame: string[] = [];
  
  for (const cluster of faceClusters) {
    // Проверяем, появляется ли это лицо в сцене
    const appearsInScene = cluster.faces.some(face => 
      face.timestamp >= sceneStartSec && face.timestamp <= sceneEndSec
    );
    
    if (appearsInScene && cluster.characterName) {
      if (!facesInFrame.includes(cluster.characterName)) {
        facesInFrame.push(cluster.characterName);
      }
    }
  }
  
  // 2. Определяем кто говорит (dominant speaker)
  const wordsInScene = diarizationWords.filter(w =>
    w.start >= sceneStartMs && w.end <= sceneEndMs
  );
  
  const speakerWordCount = new Map<string, number>();
  for (const word of wordsInScene) {
    speakerWordCount.set(
      word.speaker,
      (speakerWordCount.get(word.speaker) || 0) + 1
    );
  }
  
  const sortedSpeakers = Array.from(speakerWordCount.entries())
    .sort((a, b) => b[1] - a[1]);
  
  const dominantSpeaker = sortedSpeakers[0]?.[0] || null;
  
  // 3. Определяем персонажа по speaker
  const speakingCharacter = dominantSpeaker
    ? speakerToCharacter.get(dominantSpeaker) || null
    : null;
  
  // 4. Проверяем ЗК (за кадром)
  const isOffScreen = speakingCharacter
    ? !facesInFrame.includes(speakingCharacter)
    : false;
  
  return {
    facesInFrame,
    dominantSpeaker,
    speakingCharacter,
    isOffScreen
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// КАЛИБРОВКА ЧЕРЕЗ УПОМИНАНИЯ ИМЁН
// ═══════════════════════════════════════════════════════════════════════════

// Character interface is imported from face-types.ts

/**
 * Калибрует speakers через упоминания имён в тексте
 * 
 * Логика: Если Speaker A говорит "Галь!", а следующим отвечает Speaker B,
 * то Speaker B вероятно = ГАЛИНА
 * 
 * @param diarizationWords - Слова
 * @param characters - Список персонажей с вариантами имён
 */
export function calibrateSpeakersByNameMentions(
  diarizationWords: DiarizedWord[],
  characters: Character[]
): Map<string, string> {
  
  console.log('\n📛 CALIBRATING SPEAKERS BY NAME MENTIONS');
  
  const speakerToCharacter = new Map<string, string>();
  const usedCharacters = new Set<string>();
  
  // Сортируем слова по времени
  const sortedWords = [...diarizationWords].sort((a, b) => a.start - b.start);
  
  for (let i = 0; i < sortedWords.length - 1; i++) {
    const word = sortedWords[i];
    const wordLower = word.text.toLowerCase();
    
    // Проверяем каждого персонажа
    for (const char of characters) {
      for (const variant of char.variants) {
        const variantLower = variant.toLowerCase();
        
        // Ищем упоминание имени (обращение)
        if (wordLower.includes(variantLower)) {
          // Смотрим кто отвечает (следующий speaker)
          for (let j = i + 1; j < Math.min(i + 10, sortedWords.length); j++) {
            const nextWord = sortedWords[j];
            
            if (nextWord.speaker !== word.speaker) {
              // Другой speaker отвечает
              if (!speakerToCharacter.has(nextWord.speaker) && !usedCharacters.has(char.name)) {
                speakerToCharacter.set(nextWord.speaker, char.name);
                usedCharacters.add(char.name);
                console.log(`   ✅ Speaker ${nextWord.speaker} → ${char.name} (mentioned: "${word.text}")`);
              }
              break;
            }
          }
        }
        
        // Ищем самопрезентацию: "Я Галя", "меня зовут Галя"
        const selfPatterns = [
          `я ${variantLower}`,
          `меня ${variantLower}`,
          `это ${variantLower}`,
        ];
        
        // Проверяем контекст (текущее + предыдущие слова)
        const context = sortedWords.slice(Math.max(0, i - 2), i + 1)
          .map(w => w.text.toLowerCase())
          .join(' ');
        
        for (const pattern of selfPatterns) {
          if (context.includes(pattern)) {
            if (!speakerToCharacter.has(word.speaker) && !usedCharacters.has(char.name)) {
              speakerToCharacter.set(word.speaker, char.name);
              usedCharacters.add(char.name);
              console.log(`   ✅ Speaker ${word.speaker} → ${char.name} (self: "${context}")`);
            }
          }
        }
      }
    }
  }
  
  console.log(`   📊 Calibrated ${speakerToCharacter.size} speakers by name mentions\n`);
  
  return speakerToCharacter;
}

// ═══════════════════════════════════════════════════════════════════════════
// ОБЪЕДИНЕНИЕ ВСЕХ МЕТОДОВ КАЛИБРОВКИ
// ═══════════════════════════════════════════════════════════════════════════

// FullCalibrationResult interface is imported from face-types.ts

/**
 * Полная калибровка: объединяет все методы
 * 
 * 1. Калибровка по упоминаниям имён (name mentions)
 * 2. Связывание лиц со спикерами (face-speaker binding)
 * 3. Обратная калибровка (если лица известны)
 */
export function performFullCalibration(
  faceClusters: FaceCluster[],
  diarizationWords: DiarizedWord[],
  characters: Character[]
): FullCalibrationResult {
  
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 FULL CALIBRATION PIPELINE');
  console.log('═'.repeat(60));
  
  // Шаг 1: Калибровка по именам
  const speakerToCharacterFromNames = calibrateSpeakersByNameMentions(
    diarizationWords,
    characters
  );
  
  // Шаг 2: Связывание лиц со спикерами
  const faceToCharacter = bindFacesToSpeakers(
    faceClusters,
    diarizationWords,
    speakerToCharacterFromNames
  );
  
  // Шаг 3: Обратная калибровка (дополняем speakers из faces)
  const speakerToCharacterFromFaces = calibrateSpeakersFromFaces(
    faceClusters,
    diarizationWords
  );
  
  // Объединяем все calibrations
  const speakerToCharacter = new Map([
    ...speakerToCharacterFromNames,
    ...speakerToCharacterFromFaces
  ]);
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 CALIBRATION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Speakers calibrated: ${speakerToCharacter.size}`);
  console.log(`   Faces bound: ${faceToCharacter.size}`);
  console.log('');
  console.log('   Speaker → Character:');
  for (const [speaker, char] of speakerToCharacter) {
    console.log(`      ${speaker} → ${char}`);
  }
  console.log('');
  console.log('   Face → Character:');
  for (const [face, char] of faceToCharacter) {
    console.log(`      ${face} → ${char}`);
  }
  console.log('═'.repeat(60) + '\n');
  
  return {
    speakerToCharacter,
    faceToCharacter,
    faceClusters
  };
}
