/**
 * API: Получить список видео пользователя
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createServiceRoleClient();
  
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, original_filename, status, created_at, duration')
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  return NextResponse.json({ videos: videos || [] });
}
