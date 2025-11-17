import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Creates a signed URL for direct upload to Supabase Storage
 * This bypasses Vercel's 4.5MB body size limit
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filename, fileType, fileSize } = await request.json();

    if (!filename || !fileType) {
      return NextResponse.json(
        { error: 'Missing filename or fileType' },
        { status: 400 }
      );
    }

    // Generate unique storage path
    const timestamp = Date.now();
    const fileExt = filename.split('.').pop();
    const uniqueFilename = `${timestamp}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const storagePath = `${user.id}/${uniqueFilename}`;

    console.log(`📤 Creating upload URL for: ${filename} (${fileSize} bytes)`);

    // Create signed upload URL (valid for 10 minutes)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')
      .createSignedUploadUrl(storagePath);

    if (uploadError || !uploadData) {
      console.error('Error creating upload URL:', uploadError);
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      uploadUrl: uploadData.signedUrl,
      storagePath: uploadData.path,
      token: uploadData.token,
    });

  } catch (error) {
    console.error('Error in create-upload-url:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

