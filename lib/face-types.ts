/**
 * Face Recognition Types
 * 
 * Типы для Face Recognition модуля.
 * Вынесены в отдельный файл, чтобы избежать загрузки тяжёлых зависимостей (face-api.js)
 * при импорте только типов.
 * 
 * @author AI Assistant
 * @date 2026-01-18
 */

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ ДЛЯ FACE CLUSTERING
// ═══════════════════════════════════════════════════════════════════════════

export interface FaceInstance {
  descriptor: Float32Array | number[];
  timestamp: number;        // Время в секундах
  confidence: number;       // Уверенность детекции (0-1)
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceCluster {
  clusterId: string;        // "FACE_0", "FACE_1", ...
  faces: FaceInstance[];    // Все экземпляры этого лица (может быть пустым в worker mode)
  faceTimestamps?: number[]; // Timestamps лиц (сек) - используется когда faces пустой
  centroid: Float32Array | number[];   // Центроид для сравнения
  appearances: number;      // Сколько раз появлялся
  firstSeen: number;        // Первое появление (сек)
  lastSeen: number;         // Последнее появление (сек)
  characterName?: string;   // После binding: "ГАЛИНА", "ЮСЕФ", ...
}

// ═══════════════════════════════════════════════════════════════════════════
// ТИПЫ ДЛЯ FACE-SPEAKER BINDING
// ═══════════════════════════════════════════════════════════════════════════

export interface DiarizedWord {
  text: string;
  speaker: string;      // "A", "B", "C", ...
  start: number;        // мс
  end: number;          // мс
  confidence?: number;
}

export interface SpeakerBinding {
  clusterId: string;      // "FACE_0"
  speakerId: string;      // "A"
  characterName: string;  // "ГАЛИНА"
  confidence: number;     // 0-1
  matchedWords: number;   // Сколько слов совпало
  method: 'temporal' | 'name_mention' | 'manual';
}

export interface SceneCharacterInfo {
  facesInFrame: string[];         // ["ГАЛИНА", "ЮСЕФ"]
  dominantSpeaker: string | null; // "A"
  speakingCharacter: string | null;  // "ГАЛИНА"
  isOffScreen: boolean;           // true если говорит не из кадра
}

export interface Character {
  name: string;         // "ГАЛИНА"
  variants: string[];   // ["Галя", "Галина", "Галь", "Галюня"]
}

export interface FullCalibrationResult {
  speakerToCharacter: Map<string, string>;
  faceToCharacter: Map<string, string>;
  faceClusters: FaceCluster[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ОПЦИИ ДЛЯ ФУНКЦИЙ
// ═══════════════════════════════════════════════════════════════════════════

export interface ClusteringOptions {
  frameInterval?: number;      // Интервал между кадрами (сек)
  distanceThreshold?: number;  // Порог схожести лиц
  minAppearances?: number;     // Минимум появлений для кластера
  outputDir?: string;          // Папка для временных файлов
}
