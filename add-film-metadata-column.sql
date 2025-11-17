-- Add film_metadata_json column to videos table
-- This column will store the film metadata as JSONB

ALTER TABLE videos ADD COLUMN IF NOT EXISTS film_metadata_json JSONB;

-- Add index for faster queries on film metadata
CREATE INDEX IF NOT EXISTS idx_videos_film_metadata ON videos USING GIN (film_metadata_json);

-- Add comment to explain the column
COMMENT ON COLUMN videos.film_metadata_json IS 'Stores film metadata including producer, director, year, country, etc.';

