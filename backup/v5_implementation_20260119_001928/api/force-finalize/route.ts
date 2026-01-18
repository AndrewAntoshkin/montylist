import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deduplicateScenes } from '@/lib/video-chunking';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return NextResponse.json(
      { error: 'Missing videoId parameter. Usage: /api/force-finalize?videoId=YOUR_VIDEO_ID' },
      { status: 400 }
    );
  }

  console.log(`🔄 Force-finalizing video ${videoId}...`);

  try {
    const supabase = createServiceRoleClient();

    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const chunkProgress = video.chunk_progress_json;
    if (!chunkProgress) {
      return NextResponse.json({ error: 'Chunk progress not found' }, { status: 400 });
    }

    // Count actual entries in database (source of truth)
    const { data: allEntries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', chunkProgress.sheetId)
      .order('timecode_start', { ascending: true });

    if (entriesError) {
      return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
    }

    console.log(`📊 Found ${allEntries?.length || 0} entries in database`);

    if (!allEntries || allEntries.length === 0) {
      return NextResponse.json({ 
        error: 'No entries found in database',
        sheetId: chunkProgress.sheetId 
      }, { status: 400 });
    }

    // Get unique chunks
    const chunksWithEntries = new Set(allEntries.map((e: any) => e.chunk_index));
    console.log(`📊 Chunks with entries: ${chunksWithEntries.size} (${[...chunksWithEntries].sort((a,b) => a-b).join(', ')})`);

    // Deduplicate scenes
    console.log('🔄 Deduplicating scenes...');
    const deduplicatedEntries = deduplicateScenes(allEntries);
    console.log(`📊 After deduplication: ${deduplicatedEntries.length} entries (was ${allEntries.length})`);

    // Delete old entries and insert deduplicated
    const { error: deleteError } = await supabase
      .from('montage_entries')
      .delete()
      .eq('sheet_id', chunkProgress.sheetId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
    }

    // Reorder and renumber
    const reorderedEntries = deduplicatedEntries
      .sort((a, b) => a.timecode_start.localeCompare(b.timecode_start))
      .map((entry, index) => ({
        ...entry,
        id: undefined, // Let DB generate new IDs
        plan_number: index + 1,
        order_index: index
      }));

    // Insert in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < reorderedEntries.length; i += BATCH_SIZE) {
      const batch = reorderedEntries.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('montage_entries')
        .insert(batch);

      if (insertError) {
        console.error(`Insert batch ${i / BATCH_SIZE + 1} error:`, insertError);
      }
    }

    // Update video status to completed
    await supabase
      .from('videos')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', videoId);

    // Update sheet
    await supabase
      .from('montage_sheets')
      .update({
        total_plans: reorderedEntries.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', chunkProgress.sheetId);

    console.log(`✅ Video ${videoId} finalized with ${reorderedEntries.length} plans`);

    return NextResponse.json({
      success: true,
      message: 'Video finalized successfully',
      stats: {
        originalEntries: allEntries.length,
        deduplicatedEntries: deduplicatedEntries.length,
        finalPlans: reorderedEntries.length,
        chunksProcessed: chunksWithEntries.size
      }
    });
  } catch (error) {
    console.error('Force-finalize error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


