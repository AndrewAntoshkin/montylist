import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deduplicateScenes } from '@/lib/video-chunking';
import { validateMontageEntries } from '@/lib/validate-montage';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Automatically fix common montage issues
 * POST /api/fix-montage-issues
 * Body: { videoId }
 * 
 * Fixes:
 * - Removes duplicates
 * - Renumbers scenes (1, 2, 3... without gaps)
 * - Sorts by timecode
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

    console.log(`🔧 Auto-fix requested for video ${videoId}`);

    const supabase = createServiceRoleClient();

    // Get montage sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('montage_sheets')
      .select('*')
      .eq('video_id', videoId)
      .order('created_at', { ascending: true })
      .limit(1)
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

    const originalCount = entries.length;
    console.log(`📊 Original entry count: ${originalCount}`);

    // Validate before fixing
    console.log('🔍 Running validation before fixes...');
    const beforeValidation = validateMontageEntries(entries);
    console.log(`   Duplicates: ${beforeValidation.stats.duplicates}`);
    console.log(`   Gaps: ${beforeValidation.stats.timelineGaps}`);
    console.log(`   Invalid timecodes: ${beforeValidation.stats.invalidTimecodes}`);

    // Apply fixes
    let fixedEntries = entries;

    // Fix 1: Deduplicate
    if (beforeValidation.stats.duplicates > 0) {
      console.log('🔧 Removing duplicates...');
      fixedEntries = deduplicateScenes(fixedEntries);
      console.log(`   Removed ${originalCount - fixedEntries.length} duplicates`);
    }

    // Fix 2: Delete old entries and insert fixed ones
    if (fixedEntries.length < originalCount) {
      const idsToKeep = new Set(fixedEntries.map(e => e.id));
      const idsToDelete = entries
        .filter(e => !idsToKeep.has(e.id))
        .map(e => e.id);

      if (idsToDelete.length > 0) {
        console.log(`🗑️  Deleting ${idsToDelete.length} duplicate entries from database...`);
        const { error: deleteError } = await supabase
          .from('montage_entries')
          .delete()
          .in('id', idsToDelete);

        if (deleteError) {
          console.error('Error deleting duplicates:', deleteError);
        } else {
          console.log(`✅ Deleted ${idsToDelete.length} duplicates`);
        }
      }
    }

    // Fix 3: Renumber with continuous indices (1, 2, 3...)
    console.log('🔧 Renumbering scenes...');
    const updates = fixedEntries.map((entry, index) => ({
      id: entry.id,
      order_index: index + 1,
    }));

    for (const update of updates) {
      await supabase
        .from('montage_entries')
        .update({ order_index: update.order_index })
        .eq('id', update.id);
    }

    console.log(`✅ Renumbered ${updates.length} scenes (1-${updates.length})`);

    // Validate after fixing
    console.log('\n🔍 Running validation after fixes...');
    const afterValidation = validateMontageEntries(fixedEntries);

    return NextResponse.json({
      success: true,
      message: 'Montage issues fixed',
      before: {
        totalScenes: originalCount,
        duplicates: beforeValidation.stats.duplicates,
        gaps: beforeValidation.stats.timelineGaps,
        errors: beforeValidation.errors.length,
        warnings: beforeValidation.warnings.length,
      },
      after: {
        totalScenes: fixedEntries.length,
        duplicates: afterValidation.stats.duplicates,
        gaps: afterValidation.stats.timelineGaps,
        errors: afterValidation.errors.length,
        warnings: afterValidation.warnings.length,
      },
      fixed: {
        removedDuplicates: originalCount - fixedEntries.length,
        renumbered: true,
      },
    });

  } catch (error) {
    console.error('Error fixing montage issues:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}












