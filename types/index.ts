// Database Types

export type VideoStatus = 'uploading' | 'processing' | 'completed' | 'error';

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface ChunkProgress {
  totalChunks: number;
  completedChunks: number;
  currentChunk: number;
  chunks: Array<{
    index: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    startTimecode: string;
    endTimecode: string;
  }>;
}

export interface FilmMetadata {
  producer_company?: string; // Фирма-производитель
  release_year?: string; // Год выпуска
  country?: string; // Страна производства
  screenwriter?: string; // Автор (ы) сценария
  director?: string; // Режиссер-постановщик
  copyright_holder?: string; // Правообладатель (и)
  duration_text?: string; // Продолжительность фильма (текстовое)
  episodes_count?: string; // Количество серий
  frame_format?: string; // Формат кадра
  color_format?: string; // Цветной / черно-белый
  media_carrier?: string; // Носитель информации
  original_language?: string; // Язык оригинала
  subtitles_language?: string; // Язык надписей
  audio_language?: string; // Язык фонограммы
}

export interface Video {
  id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  storage_path: string;
  file_size?: number;
  duration?: number;
  status: VideoStatus;
  error_message?: string;
  replicate_prediction_id?: string;
  chunk_progress?: ChunkProgress; // метаданные прогресса по чанкам
  film_metadata?: FilmMetadata; // метаданные фильма
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface MontageSheet {
  id: string;
  video_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface MontageEntry {
  id: string;
  sheet_id: string;
  plan_number: number;
  start_timecode: string;
  end_timecode: string;
  plan_type?: string;
  description?: string;
  dialogues?: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

// Extended types with relations
export interface VideoWithSheet extends Video {
  montage_sheet?: MontageSheet;
}

export interface MontageSheetWithEntries extends MontageSheet {
  entries: MontageEntry[];
  video: Video;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

// Replicate types
export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: any;
  error?: string;
}

// Gemini parsed response
export interface ParsedScene {
  timecode: string; // "15:20 - 15:29"
  start_timecode: string; // "15:20"
  end_timecode: string; // "15:29"
  plan_type: string; // "Кр.", "Ср.", "Общ.", etc.
  description: string;
  dialogues: string;
}


