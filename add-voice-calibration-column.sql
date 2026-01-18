-- Добавляем колонки для полной диаризации аудио
-- 
-- full_diarization - результат AssemblyAI на ВЕСЬ фильм (стабильные Speaker ID)
-- voice_calibration - старая колонка (можно не использовать)

-- Полная диаризация (JSON):
-- {
--   "videoId": "uuid",
--   "result": {
--     "words": [{ "word": "...", "start": 1000, "end": 1500, "speaker": "A", "confidence": 0.95 }],
--     "speakers": ["A", "B", "C"],
--     "speakerCount": 3,
--     "totalDuration": 2880,
--     "text": "полный текст..."
--   },
--   "speakerMapping": [
--     { "speakerId": "A", "characterName": "ТОМА", "confidence": 0.9, "calibrationTimecode": "00:01:30:00" }
--   ],
--   "createdAt": timestamp
-- }

ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS full_diarization TEXT;

ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS voice_calibration TEXT;

COMMENT ON COLUMN videos.full_diarization IS 'JSON с полной диаризацией аудио от AssemblyAI (стабильные Speaker ID на весь фильм)';
COMMENT ON COLUMN videos.voice_calibration IS 'DEPRECATED: использовать full_diarization';

