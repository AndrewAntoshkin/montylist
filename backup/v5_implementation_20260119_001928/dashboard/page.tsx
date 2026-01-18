import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardClient from '@/components/DashboardClient';
import type { Video } from '@/types';

export default async function DashboardPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/auth/login');
  }

  // Fetch user's videos
  const { data: videos, error } = await supabase
    .from('videos')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Map chunk_progress_json to chunk_progress
  const mappedVideos = (videos || []).map((video: any) => ({
    ...video,
    chunk_progress: video.chunk_progress_json,
  })) as Video[];

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <div className="min-h-screen bg-[#101010]">
      <DashboardClient
        videos={mappedVideos}
        user={user}
        profile={profile}
      />
    </div>
  );
}


