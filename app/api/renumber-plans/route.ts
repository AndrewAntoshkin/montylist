import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * API endpoint to renumber all plans in a video with continuous numbering
 * This fixes any gaps in plan_number that may have occurred during processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId } = body;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }

    console.log(`🔢 Renumbering plans for video ${videoId}`);

    const supabase = createServiceRoleClient();

    // Get video and its sheet
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, montage_sheets(id)')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    const sheetId = (video.montage_sheets as any)?.[0]?.id;
    if (!sheetId) {
      return NextResponse.json(
        { error: 'Montage sheet not found' },
        { status: 404 }
      );
    }

    // Get all entries sorted by order_index (or start_timecode if order_index is problematic)
    const { data: entries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheetId)
      .order('order_index', { ascending: true });

    if (entriesError) {
      console.error('Error fetching entries:', entriesError);
      return NextResponse.json(
        { error: 'Failed to fetch montage entries' },
        { status: 500 }
      );
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json(
        { error: 'No entries found' },
        { status: 404 }
      );
    }

    console.log(`📊 Found ${entries.length} entries to renumber`);

    // Check if renumbering is needed
    const needsRenumbering = entries.some((entry, index) => 
      entry.plan_number !== index + 1
    );

    if (!needsRenumbering) {
      console.log(`✅ Plans are already numbered correctly (1-${entries.length})`);
      return NextResponse.json({
        success: true,
        message: 'Plans are already numbered correctly',
        totalEntries: entries.length,
      });
    }

    // Renumber all entries with continuous numbering
    const updates = entries.map((entry, index) => ({
      id: entry.id,
      plan_number: index + 1,
      order_index: index + 1,
    }));

    console.log(`🔄 Renumbering ${updates.length} entries...`);

    // Update in batches for better performance
    const BATCH_SIZE = 50;
    let updatedCount = 0;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('montage_entries')
          .update({
            plan_number: update.plan_number,
            order_index: update.order_index,
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(`Error updating entry ${update.id}:`, updateError);
          // Continue with other updates
        } else {
          updatedCount++;
        }
      }

      console.log(`✅ Updated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(updates.length / BATCH_SIZE)} (${updatedCount}/${updates.length} total)`);
    }

    console.log(`🎉 Renumbering completed! Updated ${updatedCount}/${updates.length} entries`);

    return NextResponse.json({
      success: true,
      message: 'Plans renumbered successfully',
      totalEntries: entries.length,
      updatedCount,
    });

  } catch (error) {
    console.error('Error renumbering plans:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}












