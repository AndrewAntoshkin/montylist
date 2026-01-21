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
    
    // Get sheet for this video
    const { data: sheet, error: sheetError } = await supabase
      .from('montage_sheets')
      .select('id')
      .eq('video_id', videoId)
      .single();
    
    if (sheetError || !sheet) {
      return NextResponse.json({ entries: [] });
    }
    
    // Get all entries for this sheet, ordered by plan_number
    const { data: entries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheet.id)
      .order('plan_number', { ascending: true });
    
    if (entriesError) {
      console.error('Error fetching entries:', entriesError);
      return NextResponse.json({ entries: [] });
    }
    
    return NextResponse.json({
      entries: entries || [],
      count: entries?.length || 0,
    });
  } catch (error) {
    console.error('Error fetching montage entries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
