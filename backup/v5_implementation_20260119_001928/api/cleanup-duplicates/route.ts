import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deduplicateScenes } from '@/lib/video-chunking';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Manual cleanup of duplicates for already processed video
 * POST /api/cleanup-duplicates
 * Body: { videoId }
 */
export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing required field: videoId' },
        { status: 400 }
      );
    }

    console.log(`🧹 Manual duplicate cleanup requested for video ${videoId}`);

    const supabase = createServiceRoleClient();

    // Get montage sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .maybeSingle();

    if (sheetError || !sheet) {
      return NextResponse.json(
        { error: 'Montage sheet not found' },
        { status: 404 }
      );
    }

    // Get all entries
    const { data: entries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheet.id)
      .order('order_index', { ascending: true });

    if (entriesError || !entries) {
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      );
    }

    console.log(`📊 Found ${entries.length} entries before deduplication`);

    // Deduplicate
    const deduplicatedEntries = deduplicateScenes(entries);
    console.log(`📊 After deduplication: ${deduplicatedEntries.length} entries`);

    if (deduplicatedEntries.length === entries.length) {
      console.log(`✅ No duplicates found`);
      return NextResponse.json({
        success: true,
        message: 'No duplicates found',
        totalEntries: entries.length,
      });
    }

    // Delete duplicates
    const idsToKeep = new Set(deduplicatedEntries.map(e => e.id));
    const idsToDelete = entries
      .filter(e => !idsToKeep.has(e.id))
      .map(e => e.id);

    console.log(`🗑️  Removing ${idsToDelete.length} duplicate entries`);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('montage_entries')
        .delete()
        .in('id', idsToDelete);

      if (deleteError) {
        console.error('Error deleting duplicates:', deleteError);
        return NextResponse.json(
          { error: 'Failed to delete duplicates' },
          { status: 500 }
        );
      }
    }

    // Reorder with continuous numbering
    const updates = deduplicatedEntries.map((entry, index) => ({
      id: entry.id,
      order_index: index + 1,
    }));

    for (const update of updates) {
      await supabase
        .from('montage_entries')
        .update({ order_index: update.order_index })
        .eq('id', update.id);
    }

    console.log(`✅ Reordered ${updates.length} entries with continuous numbering`);

    return NextResponse.json({
      success: true,
      message: 'Duplicates cleaned up successfully',
      originalCount: entries.length,
      finalCount: deduplicatedEntries.length,
      removedCount: idsToDelete.length,
    });

  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}












