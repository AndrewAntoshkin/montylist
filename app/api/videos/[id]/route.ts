import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get video to check ownership
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Create signed URL using Service Role client
    const serviceClient = createServiceRoleClient();
    const { data: urlData, error: urlError } = await serviceClient.storage
      .from('videos')
      .createSignedUrl(video.storage_path, 7200); // 2 hours expiry

    if (urlError || !urlData?.signedUrl) {
      console.error('Error creating signed URL:', urlError);
      return NextResponse.json(
        { error: 'Failed to create signed URL' },
        { status: 500 }
      );
    }

    // Map chunk_progress_json to chunk_progress for client
    const mappedVideo = {
      ...video,
      chunk_progress: video.chunk_progress_json,
    };

    return NextResponse.json({
      video: mappedVideo,
      signedUrl: urlData.signedUrl,
    });
  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get video to check ownership and get storage path
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Delete file from storage
    if (video.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('videos')
        .remove([video.storage_path]);

      if (storageError) {
        console.error('Error deleting file from storage:', storageError);
      }
    }

    // Delete video record (this will cascade delete montage_sheets and entries due to foreign keys)
    const { error: deleteError } = await supabase
      .from('videos')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Error deleting video:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete video' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

