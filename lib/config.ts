/**
 * Centralized Configuration for V5 Processing
 * 
 * Все константы обработки в одном месте для удобства настройки.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSING LIMITS
// ═══════════════════════════════════════════════════════════════════════════

/** Максимум одновременно обрабатываемых чанков */
export const MAX_CONCURRENT_CHUNKS = 1;

/** Максимальное время обработки одного чанка (5 минут) */
export const CHUNK_TIMEOUT_MS = 300000;

/** Максимальное время ожидания FAL.ai (5 минут) */
export const FAL_TIMEOUT_MS = 300000;

/** Максимальное время ожидания Gemini/Replicate (5 минут) */
export const GEMINI_TIMEOUT_MS = 300000;

/** Максимум retry попыток для чанка */
export const MAX_CHUNK_RETRIES = 3;

// ═══════════════════════════════════════════════════════════════════════════
// TIMEOUTS FOR STUCK DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/** Timeout для 'triggering' статуса (60 секунд) */
export const TRIGGERING_TIMEOUT_MS = 60 * 1000;

/** Timeout для 'in_progress' статуса (20 минут) */
export const STUCK_CHUNK_TIMEOUT_MS = 20 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

/** Порог ошибок для срабатывания Circuit Breaker */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/** Cooldown после срабатывания Circuit Breaker (60 секунд) */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 60000;

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

/** Длина одного чанка в секундах (3 минуты) */
export const CHUNK_DURATION_SECONDS = 180;

/** Количество параллельных загрузок чанков в Supabase */
export const PARALLEL_UPLOADS = 4;

/** Максимум персонажей для промпта Gemini/FAL */
export const MAX_CHARACTERS_IN_PROMPT = 15;

/** Максимум сцен из сценария для контекста */
export const MAX_SCRIPT_SCENES_IN_PROMPT = 5;

// ═══════════════════════════════════════════════════════════════════════════
// ASR / DIARIZATION
// ═══════════════════════════════════════════════════════════════════════════

/** Максимум спикеров для диаризации */
export const MAX_SPEAKERS = 15;

/** Минимальная пауза для разделения реплик (1 секунда) */
export const DIALOGUE_PAUSE_THRESHOLD_MS = 1000;

/** Окно назад для привязки слов к сценам (300ms) */
export const BACKWARD_WINDOW_MS = 300;

// ═══════════════════════════════════════════════════════════════════════════
// FACE RECOGNITION
// ═══════════════════════════════════════════════════════════════════════════

/** Порог доминирования для ЗК (30%) */
export const FACE_DOMINANCE_THRESHOLD = 0.3;

/** Порог уверенности для ЗК (80%) */
export const OFFSCREEN_CONFIDENCE_THRESHOLD = 0.8;

/** Окно вперёд для face presence (3.5 секунды) */
export const FORWARD_WINDOW_FACE_SEC = 3.5;

/** Окно назад для face presence (1.5 секунды) */
export const BACKWARD_WINDOW_FACE_SEC = 1.5;

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════════════════

/** Включить face recognition */
export const USE_FACE_RECOGNITION = process.env.USE_FACE_RECOGNITION === 'true';

/** Включить voice embeddings */
export const USE_VOICE_EMBEDDINGS = process.env.USE_VOICE_EMBEDDINGS === 'true';

/** Включить полную диаризацию */
export const USE_FULL_DIARIZATION = true;

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL AS OBJECT (for convenience)
// ═══════════════════════════════════════════════════════════════════════════

export const PROCESSING_CONFIG = {
  MAX_CONCURRENT_CHUNKS,
  CHUNK_TIMEOUT_MS,
  FAL_TIMEOUT_MS,
  GEMINI_TIMEOUT_MS,
  MAX_CHUNK_RETRIES,
  TRIGGERING_TIMEOUT_MS,
  STUCK_CHUNK_TIMEOUT_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CHUNK_DURATION_SECONDS,
  PARALLEL_UPLOADS,
  MAX_CHARACTERS_IN_PROMPT,
  MAX_SCRIPT_SCENES_IN_PROMPT,
  MAX_SPEAKERS,
  DIALOGUE_PAUSE_THRESHOLD_MS,
  BACKWARD_WINDOW_MS,
  FACE_DOMINANCE_THRESHOLD,
  OFFSCREEN_CONFIDENCE_THRESHOLD,
  FORWARD_WINDOW_FACE_SEC,
  BACKWARD_WINDOW_FACE_SEC,
  USE_FACE_RECOGNITION,
  USE_VOICE_EMBEDDINGS,
  USE_FULL_DIARIZATION,
} as const;
