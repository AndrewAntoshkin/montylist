/**
 * Client-side chunked video processing orchestrator
 * Coordinates the 3-step chunked processing workflow
 */

export interface ChunkInfo {
  index: number;
  startTimecode: string;
  endTimecode: string;
  storageUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ProcessingProgress {
  stage: 'initializing' | 'processing_chunks' | 'finalizing' | 'completed' | 'failed';
  currentChunk: number;
  totalChunks: number;
  completedChunks: number;
  error?: string;
}

/**
 * Start chunked video processing
 * Returns a function that can be called to check progress
 */
export async function startChunkedProcessing(
  videoId: string,
  videoUrl: string,
  videoDuration: number,
  filmMetadata?: any,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<{ success: boolean; sheetId?: string; error?: string }> {
  try {
    console.log('🎬 Starting chunked processing workflow...');

    // Step 1: Initialize and split video into chunks
    onProgress?.({
      stage: 'initializing',
      currentChunk: 0,
      totalChunks: 0,
      completedChunks: 0,
    });

    const initResponse = await fetch('/api/init-chunked-processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, videoUrl, videoDuration }),
    });

    if (!initResponse.ok) {
      const error = await initResponse.json();
      throw new Error(error.error || 'Failed to initialize processing');
    }

    const initData = await initResponse.json();
    const { chunks, sheetId, totalChunks } = initData;

    console.log(`✅ Initialized: ${totalChunks} chunks ready`);

    // Step 2: Process each chunk
    onProgress?.({
      stage: 'processing_chunks',
      currentChunk: 0,
      totalChunks,
      completedChunks: 0,
    });

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`📹 Processing chunk ${i + 1}/${totalChunks}...`);
      
      onProgress?.({
        stage: 'processing_chunks',
        currentChunk: i,
        totalChunks,
        completedChunks: i,
      });

      const chunkResponse = await fetch('/api/process-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          chunkIndex: chunk.index,
          chunkStorageUrl: chunk.storageUrl,
          startTimecode: chunk.startTimecode,
          endTimecode: chunk.endTimecode,
          filmMetadata,
        }),
      });

      if (!chunkResponse.ok) {
        const error = await chunkResponse.json();
        throw new Error(`Failed to process chunk ${i + 1}: ${error.error}`);
      }

      const chunkData = await chunkResponse.json();
      console.log(`✅ Chunk ${i + 1}/${totalChunks} completed: ${chunkData.scenesCount} scenes`);
    }

    console.log('✅ All chunks processed');

    // Step 3: Finalize processing (deduplicate, reorder)
    onProgress?.({
      stage: 'finalizing',
      currentChunk: totalChunks,
      totalChunks,
      completedChunks: totalChunks,
    });

    const finalizeResponse = await fetch('/api/finalize-processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json();
      throw new Error(error.error || 'Failed to finalize processing');
    }

    const finalizeData = await finalizeResponse.json();
    console.log(`🎉 Processing completed! Total entries: ${finalizeData.totalEntries}`);

    onProgress?.({
      stage: 'completed',
      currentChunk: totalChunks,
      totalChunks,
      completedChunks: totalChunks,
    });

    return {
      success: true,
      sheetId,
    };

  } catch (error) {
    console.error('❌ Chunked processing failed:', error);
    
    onProgress?.({
      stage: 'failed',
      currentChunk: 0,
      totalChunks: 0,
      completedChunks: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process chunks in parallel (experimental - may hit rate limits)
 * Use with caution - parallel processing can be faster but may fail more often
 */
export async function startChunkedProcessingParallel(
  videoId: string,
  videoUrl: string,
  videoDuration: number,
  filmMetadata?: any,
  maxParallel: number = 2,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<{ success: boolean; sheetId?: string; error?: string }> {
  try {
    // Step 1: Initialize
    onProgress?.({
      stage: 'initializing',
      currentChunk: 0,
      totalChunks: 0,
      completedChunks: 0,
    });

    const initResponse = await fetch('/api/init-chunked-processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, videoUrl, videoDuration }),
    });

    if (!initResponse.ok) {
      const error = await initResponse.json();
      throw new Error(error.error || 'Failed to initialize processing');
    }

    const initData = await initResponse.json();
    const { chunks, sheetId, totalChunks } = initData;

    // Step 2: Process chunks in parallel batches
    onProgress?.({
      stage: 'processing_chunks',
      currentChunk: 0,
      totalChunks,
      completedChunks: 0,
    });

    let completedChunks = 0;

    // Process in batches
    for (let i = 0; i < chunks.length; i += maxParallel) {
      const batch = chunks.slice(i, i + maxParallel);
      
      const batchPromises = batch.map((chunk: ChunkInfo) =>
        fetch('/api/process-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            chunkIndex: chunk.index,
            chunkStorageUrl: chunk.storageUrl,
            startTimecode: chunk.startTimecode,
            endTimecode: chunk.endTimecode,
            filmMetadata,
          }),
        }).then(res => {
          if (!res.ok) throw new Error(`Chunk ${chunk.index} failed`);
          return res.json();
        })
      );

      await Promise.all(batchPromises);
      completedChunks += batch.length;

      onProgress?.({
        stage: 'processing_chunks',
        currentChunk: completedChunks - 1,
        totalChunks,
        completedChunks,
      });
    }

    // Step 3: Finalize
    onProgress?.({
      stage: 'finalizing',
      currentChunk: totalChunks,
      totalChunks,
      completedChunks: totalChunks,
    });

    const finalizeResponse = await fetch('/api/finalize-processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!finalizeResponse.ok) {
      const error = await finalizeResponse.json();
      throw new Error(error.error || 'Failed to finalize processing');
    }

    onProgress?.({
      stage: 'completed',
      currentChunk: totalChunks,
      totalChunks,
      completedChunks: totalChunks,
    });

    return { success: true, sheetId };

  } catch (error) {
    onProgress?.({
      stage: 'failed',
      currentChunk: 0,
      totalChunks: 0,
      completedChunks: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

