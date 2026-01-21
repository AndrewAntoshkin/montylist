/**
 * Trigger Chunk 16 manually
 * 
 * This script checks the status of chunk 16 and triggers it if it's pending
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function triggerChunk16() {
  try {
    // Get the latest video (assuming it's the one being processed)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, chunk_progress_json')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !videos || videos.length === 0) {
      console.error('❌ No videos found');
      return;
    }

    const video = videos[0];
    const videoId = video.id;
    const chunkProgress = video.chunk_progress_json;

    console.log(`\n📹 Video ID: ${videoId}`);
    console.log(`   Total chunks: ${chunkProgress.totalChunks}`);
    
    // Find chunk 16 (index 15, since chunks are 0-indexed)
    const chunk16 = chunkProgress.chunks.find((c: any) => c.index === 15);
    
    if (!chunk16) {
      console.error('❌ Chunk 16 not found');
      return;
    }

    console.log(`\n📦 Chunk 16 status: ${chunk16.status}`);
    console.log(`   Start timecode: ${chunk16.startTimecode}`);
    console.log(`   End timecode: ${chunk16.endTimecode}`);
    console.log(`   Storage URL: ${chunk16.storageUrl ? 'Yes' : 'No'}`);

    if (chunk16.status === 'completed') {
      console.log('\n✅ Chunk 16 is already completed!');
      return;
    }

    if (!chunk16.storageUrl) {
      console.error('\n❌ Chunk 16 has no storage URL');
      return;
    }

    // Trigger chunk 16
    console.log('\n🚀 Triggering chunk 16...');
    
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/process-chunk-v5`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-request': 'true',
      },
      body: JSON.stringify({
        videoId,
        chunkIndex: 15, // Chunk 16 is index 15
        chunkUrl: chunk16.storageUrl,
        startTimecode: chunk16.startTimecode,
        endTimecode: chunk16.endTimecode,
      }),
    });

    if (response.ok) {
      console.log('✅ Chunk 16 triggered successfully!');
      const result = await response.json();
      console.log('   Response:', result);
    } else {
      console.error(`❌ Failed to trigger chunk 16: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('   Error:', errorText);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

triggerChunk16();
