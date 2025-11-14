-- Carete Montage Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create videos table
CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  duration INTEGER, -- duration in seconds
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'completed', 'error')),
  error_message TEXT,
  replicate_prediction_id TEXT,
  chunk_progress_json JSONB, -- прогресс обработки чанков для длинных видео
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create montage_sheets table
CREATE TABLE IF NOT EXISTS public.montage_sheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create montage_entries table (individual rows in the montage sheet)
CREATE TABLE IF NOT EXISTS public.montage_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id UUID NOT NULL REFERENCES public.montage_sheets(id) ON DELETE CASCADE,
  plan_number INTEGER NOT NULL,
  start_timecode TEXT NOT NULL, -- format: HH:MM:SS:FF or HH:MM:SS
  end_timecode TEXT NOT NULL,
  plan_type TEXT, -- Кр., Ср., Общ., Дальн., Деталь, НДП, ПНР, etc.
  description TEXT, -- Содержание (описание) плана, титры
  dialogues TEXT, -- Монологи, разговоры, песни, субтитры, музыка
  order_index INTEGER NOT NULL, -- for sorting entries
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sheet_id, plan_number)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON public.videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON public.videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON public.videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_montage_sheets_video_id ON public.montage_sheets(video_id);
CREATE INDEX IF NOT EXISTS idx_montage_sheets_user_id ON public.montage_sheets(user_id);
CREATE INDEX IF NOT EXISTS idx_montage_entries_sheet_id ON public.montage_entries(sheet_id);
CREATE INDEX IF NOT EXISTS idx_montage_entries_order ON public.montage_entries(sheet_id, order_index);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.montage_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.montage_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- RLS Policies for videos
CREATE POLICY "Users can view own videos" 
  ON public.videos FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own videos" 
  ON public.videos FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own videos" 
  ON public.videos FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own videos" 
  ON public.videos FOR DELETE 
  USING (auth.uid() = user_id);

-- RLS Policies for montage_sheets
CREATE POLICY "Users can view own sheets" 
  ON public.montage_sheets FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sheets" 
  ON public.montage_sheets FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sheets" 
  ON public.montage_sheets FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sheets" 
  ON public.montage_sheets FOR DELETE 
  USING (auth.uid() = user_id);

-- RLS Policies for montage_entries
CREATE POLICY "Users can view own entries" 
  ON public.montage_entries FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.montage_sheets 
      WHERE montage_sheets.id = montage_entries.sheet_id 
      AND montage_sheets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own entries" 
  ON public.montage_entries FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.montage_sheets 
      WHERE montage_sheets.id = montage_entries.sheet_id 
      AND montage_sheets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own entries" 
  ON public.montage_entries FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.montage_sheets 
      WHERE montage_sheets.id = montage_entries.sheet_id 
      AND montage_sheets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own entries" 
  ON public.montage_entries FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.montage_sheets 
      WHERE montage_sheets.id = montage_entries.sheet_id 
      AND montage_sheets.user_id = auth.uid()
    )
  );

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_videos
  BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_sheets
  BEFORE UPDATE ON public.montage_sheets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_entries
  BEFORE UPDATE ON public.montage_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


