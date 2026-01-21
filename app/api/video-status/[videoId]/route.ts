import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const { videoId } = await params;
    const supabase = createServiceRoleClient();
    
    const { data: video, error } = await supabase
      .from('videos')
      .select('id, status, chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    if (error || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    return NextResponse.json({
      id: video.id,
      status: video.status,
      chunk_progress_json: video.chunk_progress_json,
    });
  } catch (error) {
    console.error('Error fetching video status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
