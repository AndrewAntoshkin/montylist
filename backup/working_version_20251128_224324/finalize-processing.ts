import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/request';
import { deduplicateScenes } from '@/lib/video-chunking';
import { validateMontageEntries } from '@/lib/validate-montage';
import { validateTimecodeSequence, analyzeGapPattern } from '@/lib/timecode-validator';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let videoId: string | undefined;
  
  try {
    const body = await request.json();
    videoId = body.videoId;

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

    // Check if at least 50% of chunks are completed (allow finalization with some failed chunks)
    const completedChunks = chunkProgress.chunks.filter((chunk: any) => 
      chunk.status === 'completed'
    );
    const completionRate = completedChunks.length / chunkProgress.chunks.length;
    
    console.log(`📊 Completion rate: ${completedChunks.length}/${chunkProgress.chunks.length} (${(completionRate * 100).toFixed(0)}%)`);

    if (completionRate < 0.5) {
      // Less than 50% completed - reject finalization
      const pendingChunks = chunkProgress.chunks.filter((chunk: any) => 
        chunk.status !== 'completed'
      );
      return NextResponse.json(
        { 
          error: 'Not enough chunks completed (need at least 50%)',
          completedChunks: completedChunks.length,
          totalChunks: chunkProgress.chunks.length,
          pendingChunks: pendingChunks.map((c: any) => ({ index: c.index, status: c.status }))
        },
        { status: 400 }
      );
    }
    
    // Log if some chunks failed but we're proceeding
    const failedChunks = chunkProgress.chunks.filter((chunk: any) => 
      chunk.status === 'failed'
    );
    if (failedChunks.length > 0) {
      console.log(`⚠️  Proceeding with finalization despite ${failedChunks.length} failed chunk(s): ${failedChunks.map((c: any) => c.index).join(', ')}`);
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
    let deduplicatedEntries = entries || [];
    
    if (entries && entries.length > 0) {
      deduplicatedEntries = deduplicateScenes(entries);
      console.log(`📊 After deduplication: ${deduplicatedEntries.length} entries`);

      // If we removed duplicates, update the database
      if (deduplicatedEntries.length < entries.length) {
        // Get IDs to keep
        const idsToKeep = new Set(deduplicatedEntries.map(e => e.id));
        const idsToDelete = entries
          .filter(e => !idsToKeep.has(e.id))
          .map(e => e.id);

        console.log(`🗑️  Removing ${idsToDelete.length} duplicate entries`);

        // Delete duplicates in batches (Supabase has limits on bulk operations)
        if (idsToDelete.length > 0) {
          const BATCH_SIZE = 100; // Delete 100 at a time
          const batches = [];
          
          for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
            batches.push(idsToDelete.slice(i, i + BATCH_SIZE));
          }
          
          console.log(`🗑️  Deleting ${idsToDelete.length} duplicates in ${batches.length} batches...`);
          
          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const { error: deleteError } = await supabase
              .from('montage_entries')
              .delete()
              .in('id', batch);

            if (deleteError) {
              console.error(`Error deleting batch ${i + 1}/${batches.length}:`, deleteError);
              // Non-fatal, continue anyway
            } else {
              console.log(`✅ Deleted batch ${i + 1}/${batches.length} (${batch.length} entries)`);
            }
          }
        }

        // Reorder remaining entries with continuous numbering (no gaps)
        const updates = deduplicatedEntries.map((entry, index) => ({
          id: entry.id,
          plan_number: index + 1, // Start from 1, not 0, for display purposes
          order_index: index + 1, // Start from 1, not 0, for display purposes
        }));

        // Update plan numbers and order indices in batches
        for (const update of updates) {
          await supabase
            .from('montage_entries')
            .update({ 
              plan_number: update.plan_number,
              order_index: update.order_index 
            })
            .eq('id', update.id);
        }

        console.log(`✅ Reordered ${updates.length} entries with continuous numbering (1-${updates.length})`);
      }
    }

    // Validate final montage entries
    console.log('\n🔍 Running validation on final montage...');
    const validation = validateMontageEntries(deduplicatedEntries || entries || []);
    
    if (!validation.isValid) {
      console.error('❌ Validation failed with errors:', validation.errors);
    }
    
    if (validation.warnings.length > 0) {
      console.warn('⚠️  Validation warnings:', validation.warnings.slice(0, 10)); // Show first 10
      if (validation.warnings.length > 10) {
        console.warn(`   ... and ${validation.warnings.length - 10} more warnings`);
      }
    }
    
    if (validation.isValid && validation.warnings.length === 0) {
      console.log('✅ Validation passed with no issues!');
    } else if (validation.isValid && validation.warnings.length > 0) {
      console.log(`✅ Validation passed with ${validation.warnings.length} warnings (non-critical)`);
    }

    // Validate timecode sequence
    console.log('\n🔍 Validating timecode sequence...');
    const timecodeValidation = validateTimecodeSequence(deduplicatedEntries || entries || []);
    
    if (!timecodeValidation.isValid) {
      console.warn(`⚠️ Found ${timecodeValidation.gaps.length} gaps and ${timecodeValidation.overlaps.length} overlaps in timecodes`);
      
      // Show first 10 timecode issues
      timecodeValidation.warnings.slice(0, 10).forEach(w => console.warn(w));
      if (timecodeValidation.warnings.length > 10) {
        console.warn(`   ... and ${timecodeValidation.warnings.length - 10} more timecode warnings`);
      }
      
      // Analyze gap pattern
      const gapAnalysis = analyzeGapPattern(deduplicatedEntries || entries || []);
      console.warn(`📊 Gap pattern: ${gapAnalysis.pattern}`);
      console.warn(`💡 Suggestion: ${gapAnalysis.suggestion}`);
      
      // Calculate total lost time
      const totalLostFrames = timecodeValidation.gaps.reduce((sum, g) => sum + g.gapDuration, 0);
      const totalLostSeconds = totalLostFrames / 24; // Assuming 24fps
      console.warn(`⚠️ Total lost time: ${totalLostFrames} frames (~${totalLostSeconds.toFixed(1)} seconds)`);
    } else {
      console.log('✅ Timecode validation passed - no gaps or overlaps!');
    }
    
    // Estimate expected plan count
    console.log('\n📊 Plan count analysis...');
    const finalEntries = deduplicatedEntries || entries || [];
    if (finalEntries.length > 0) {
      // Calculate video duration from first and last plan
      const firstPlan = finalEntries[0];
      const lastPlan = finalEntries[finalEntries.length - 1];
      
      // This is approximate - just for logging
      console.log(`📊 Final montage: ${finalEntries.length} plans`);
      console.log(`📊 First plan: ${firstPlan.start_timecode}`);
      console.log(`📊 Last plan: ${lastPlan.end_timecode}`);
    }

    // Update video status to completed
    const { error: updateError } = await supabase
      .from('videos')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', videoId);

    if (updateError) {
      console.error('❌ Error updating video status:', updateError);
      throw new Error(`Failed to update video status: ${updateError.message}`);
    }

    console.log(`✅ Video status updated to completed`);

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

    // Try to update video status to failed using videoId from outer scope
    if (videoId) {
      try {
        const supabase = createServiceRoleClient();
        await supabase
          .from('videos')
          .update({ status: 'failed' })
          .eq('id', videoId);
        console.log(`✅ Updated video ${videoId} status to failed`);
      } catch (updateError) {
        console.error('Error updating video status to failed:', updateError);
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

