import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateMontageEntries } from '@/lib/validate-montage';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Validate montage entries for a video
 * POST /api/validate-montage
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

    console.log(`🔍 Validation requested for video ${videoId}`);

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

    console.log(`📊 Validating ${entries.length} entries...`);

    // Run validation
    const validation = validateMontageEntries(entries);

    console.log(`\n📊 VALIDATION COMPLETE:`);
    console.log(`   Valid: ${validation.isValid}`);
    console.log(`   Errors: ${validation.errors.length}`);
    console.log(`   Warnings: ${validation.warnings.length}`);

    return NextResponse.json({
      success: true,
      validation: {
        isValid: validation.isValid,
        stats: validation.stats,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        errors: validation.errors.slice(0, 20), // First 20 errors
        warnings: validation.warnings.slice(0, 20), // First 20 warnings
      },
    });

  } catch (error) {
    console.error('Error validating montage:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}












