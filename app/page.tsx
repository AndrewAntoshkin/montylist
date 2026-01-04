import { createClient } from '@/lib/supabase/server';
import Header from '@/components/Header';
import HomeClient from '@/components/HomeClient';

// Make page dynamic to avoid caching issues
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Get user profile if logged in
  let profile = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  // Get recent videos if logged in
  let recentVideos: Array<{
    id: string;
    title: string;
    created_at: string;
    status: string;
  }> = [];
  
  if (user) {
    const { data } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8);
    
    // Map to expected format
    recentVideos = (data || []).map(video => ({
      id: video.id,
      title: video.original_filename || video.title || 'Без названия',
      created_at: video.created_at,
      status: video.status
    }));
  }

  // Get film metadata if exists
  let filmMetadata = null;
  if (user) {
    const { data } = await supabase
      .from('film_metadata')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    filmMetadata = data;
  }

  return (
    <div className="min-h-screen bg-[#101010]">
      <Header user={user || undefined} profile={profile} />
      <HomeClient 
        user={user} 
        recentVideos={recentVideos}
        filmMetadata={filmMetadata}
      />
    </div>
  );
}
