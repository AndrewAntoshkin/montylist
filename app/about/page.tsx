import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import AboutClient from './AboutClient';

export const metadata: Metadata = {
  title: 'О сервисе - Monty',
  description: 'Автоматическое создание монтажных листов для ваших видео с помощью искусственного интеллекта',
};

export default async function AboutPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let profile = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  return (
    <div className="min-h-screen bg-[#101010]">
      <AboutClient user={user || undefined} profile={profile} />
    </div>
  );
}
