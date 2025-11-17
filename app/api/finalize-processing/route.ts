import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deduplicateScenes } from '@/lib/video-chunking';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400 }
      );
    }

    console.log(`🏁 Finalizing processing for video ${videoId}`);

    const supabase = createServiceRoleClient();

    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      throw new Error('Video not found');
    }

    const chunkProgress = video.chunk_progress_json;
    if (!chunkProgress) {
      throw new Error('Chunk progress not found');
    }

    // Check if all chunks are completed
    const allCompleted = chunkProgress.chunks.every((chunk: any) => 
      chunk.status === 'completed'
    );

    if (!allCompleted) {
      const pendingChunks = chunkProgress.chunks.filter((chunk: any) => 
        chunk.status !== 'completed'
      );
      return NextResponse.json(
        { 
          error: 'Not all chunks are completed',
          pendingChunks: pendingChunks.map((c: any) => c.index)
        },
        { status: 400 }
      );
    }

    const sheetId = chunkProgress.sheetId;
    if (!sheetId) {
      throw new Error('Sheet ID not found in chunk progress');
    }

    // Get all entries from the sheet
    const { data: entries, error: entriesError } = await supabase
      .from('montage_entries')
      .select('*')
      .eq('sheet_id', sheetId)
      .order('order_index', { ascending: true });

    if (entriesError) {
      console.error('Error fetching entries:', entriesError);
      throw new Error('Failed to fetch montage entries');
    }

    console.log(`📊 Found ${entries?.length || 0} total entries before deduplication`);

    // Deduplicate scenes (removes overlaps between chunks)
    if (entries && entries.length > 0) {
      const deduplicatedEntries = deduplicateScenes(entries);
      console.log(`📊 After deduplication: ${deduplicatedEntries.length} entries`);

      // If we removed duplicates, update the database
      if (deduplicatedEntries.length < entries.length) {
        // Get IDs to keep
        const idsToKeep = new Set(deduplicatedEntries.map(e => e.id));
        const idsToDelete = entries
          .filter(e => !idsToKeep.has(e.id))
          .map(e => e.id);

        console.log(`🗑️  Removing ${idsToDelete.length} duplicate entries`);

        // Delete duplicates
        if (idsToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from('montage_entries')
            .delete()
            .in('id', idsToDelete);

          if (deleteError) {
            console.error('Error deleting duplicates:', deleteError);
            // Non-fatal, continue anyway
          }
        }

        // Reorder remaining entries
        const updates = deduplicatedEntries.map((entry, index) => ({
          id: entry.id,
          order_index: index,
        }));

        // Update order indices in batches
        for (const update of updates) {
          await supabase
            .from('montage_entries')
            .update({ order_index: update.order_index })
            .eq('id', update.id);
        }

        console.log(`✅ Reordered ${updates.length} entries`);
      }
    }

    // Update video status to completed
    await supabase
      .from('videos')
      .update({ 
        status: 'completed',
        processed_at: new Date().toISOString()
      })
      .eq('id', videoId);

    // Get final count
    const { count: finalCount } = await supabase
      .from('montage_entries')
      .select('*', { count: 'exact', head: true })
      .eq('sheet_id', sheetId);

    console.log(`🎉 Processing completed! Final count: ${finalCount} entries`);

    return NextResponse.json({
      success: true,
      videoId,
      sheetId,
      totalEntries: finalCount || 0,
      message: 'Video processing completed successfully',
    });

  } catch (error) {
    console.error('Error finalizing processing:', error);

    // Try to update video status to failed
    try {
      const { videoId } = await request.json();
      if (videoId) {
        const supabase = createServiceRoleClient();
        await supabase
          .from('videos')
          .update({ status: 'failed' })
          .eq('id', videoId);
      }
    } catch (updateError) {
      console.error('Error updating video status:', updateError);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

