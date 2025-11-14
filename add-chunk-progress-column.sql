-- Add chunk_progress_json column to videos table if it doesn't exist
-- Run this migration in Supabase SQL Editor

DO $$ 
BEGIN
    -- Check if column exists, if not add it
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'videos' 
        AND column_name = 'chunk_progress_json'
    ) THEN
        ALTER TABLE public.videos 
        ADD COLUMN chunk_progress_json JSONB;
        
        RAISE NOTICE 'Column chunk_progress_json added successfully';
    ELSE
        RAISE NOTICE 'Column chunk_progress_json already exists';
    END IF;
END $$;

