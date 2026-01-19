/**
 * Process Chunk V5 — Улучшенная обработка чанка (BETA)
 * 
 * Ключевые отличия от V4:
 * 1. Использует pre-built speaker→character mapping
 * 2. Gemini НЕ определяет "кто говорит" — только описание и тип плана
 * 3. Face presence с 3 состояниями для ЗК/ГЗК
 * 4. Диалоги берутся из ASR, а не из Gemini
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getReplicatePool } from '@/lib/replicate-pool';
import { 
  detectFacePresence, 
  formatPresenceStatus,
  type FacePresenceResult,
} from '@/lib/face-presence-detector';
import type { FaceCluster } from '@/lib/face-types';

// 5 minutes timeout
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Types — must match lib/credits-detector.ts MergedScene (snake_case)
interface MergedScene {
  start_timecode: string;
  end_timecode: string;
  start_timestamp: number;
  end_timestamp: number;
  type: 'opening_credits' | 'closing_credits' | 'regular';
  originalScenesCount: number;
}

interface ASRWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speaker?: string;
}

interface DialogueLine {
  character: string;
  text: string;
  isOffscreen: boolean;
  startMs: number;
  endMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { videoId, chunkIndex, chunkUrl, startTimecode, endTimecode } = await request.json();
    
    if (!videoId || chunkIndex === undefined || !chunkUrl) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 V5 BETA CHUNK ${chunkIndex}: ${startTimecode} → ${endTimecode}`);
    console.log(`${'─'.repeat(60)}`);
    
    const supabase = createServiceRoleClient();
    
    // Get video and chunk progress
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    if (videoError || !video) {
      throw new Error(`Video not found: ${videoId}`);
    }
    
    const chunkProgress = video.chunk_progress_json;
    const sheetId = chunkProgress.sheetId;
    
    // Get pre-built speaker→character mapping from V5 init
    const speakerCharacterMap: Record<string, string> = chunkProgress.speakerCharacterMap || {};
    console.log(`   Speaker→Character mappings: ${Object.keys(speakerCharacterMap).length}`);
    
    // Get face clusters (if available)
    const faceClusters: FaceCluster[] = (chunkProgress.faceClusters || []).map((fc: any) => ({
      clusterId: fc.clusterId,
      appearances: fc.appearances,
      firstSeen: fc.firstSeen,
      lastSeen: fc.lastSeen,
      characterName: fc.characterName,
      centroid: fc.centroid ? new Float32Array(fc.centroid) : new Float32Array(),
      faces: (fc.faceTimestamps || []).map((t: number) => ({ 
        timestamp: t, 
        descriptor: new Float32Array(), 
        confidence: 1, 
        boundingBox: { x: 0, y: 0, width: 0, height: 0 } 
      })),
    }));
    console.log(`   Face clusters: ${faceClusters.length}`);
    
    // Get full diarization words
    const fullDiarizationWords: ASRWord[] = chunkProgress.fullDiarizationWords || [];
    console.log(`   Full diarization words: ${fullDiarizationWords.length}`);
    
    // Get merged scenes
    const mergedScenes: MergedScene[] = chunkProgress.mergedScenes || [];
    
    // Calculate chunk time range
    const chunkInfo = chunkProgress.chunks[chunkIndex];
    const chunkStartMs = parseTimecodeToMs(startTimecode);
    const chunkEndMs = parseTimecodeToMs(endTimecode);
    
    // Get scenes in this chunk (using snake_case from credits-detector)
    const scenesInChunk = mergedScenes.filter(
      s => s.start_timestamp * 1000 >= chunkStartMs - 500 && 
           s.start_timestamp * 1000 < chunkEndMs + 500
    );
    console.log(`   Scenes in chunk: ${scenesInChunk.length}`);
    
    // Calculate global plan offset (scenes before this chunk)
    const scenesBeforeThisChunk = mergedScenes.filter(
      s => s.start_timestamp * 1000 < chunkStartMs - 500
    ).length;
    console.log(`   Plan offset: ${scenesBeforeThisChunk}`);
    
    // Get script data
    const scriptData = chunkProgress.scriptData;
    const characters = scriptData?.characters || [];
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Call Gemini for visual description ONLY (with retry)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🤖 Calling Gemini for visual descriptions...`);
    
    let geminiResponse: any = null;
    const MAX_RETRIES = 3;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const replicatePool = getReplicatePool();
        const { client: replicate, release } = await replicatePool.getLeastLoadedClient();
        
        // V5 prompt: ТОЛЬКО описание и тип плана, НЕ диалоги
        const v5Prompt = buildV5Prompt(scenesInChunk, characters);
        
        try {
          const output = await replicate.run(
            "google/gemini-3-pro",  // Same model as V4
            {
              input: {
                prompt: v5Prompt,
                video: chunkUrl,
                temperature: 0.3,
                max_tokens: 8000,
              }
            }
          );
          
          geminiResponse = parseGeminiOutput(output);
          console.log(`   ✅ Gemini returned ${geminiResponse?.plans?.length || 0} plan descriptions`);
          break; // Success, exit retry loop
        } finally {
          release(); // Always release the client
        }
        
      } catch (geminiError: any) {
        const isNetworkError = geminiError?.cause?.code === 'UND_ERR_SOCKET' ||
                               geminiError?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
                               geminiError?.message?.includes('fetch failed');
        
        if (isNetworkError && attempt < MAX_RETRIES) {
          const delay = attempt * 5000; // 5s, 10s, 15s
          console.log(`   ⚠️ Network error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay/1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error(`   ❌ Gemini error (attempt ${attempt}):`, geminiError?.message || geminiError);
          // Continue without Gemini descriptions - dialogues from ASR are more important
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Build dialogues from ASR (NOT from Gemini)
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n🎤 Building dialogues from ASR...`);
    
    const planDialogues: Map<number, DialogueLine[]> = new Map();
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      const sceneStartMs = scene.start_timestamp * 1000;
      const sceneEndMs = scene.end_timestamp * 1000;
      
      // Get words in this scene
      const wordsInScene = fullDiarizationWords.filter(
        w => w.startMs >= sceneStartMs - 500 && w.endMs <= sceneEndMs + 500
      );
      
      // Group by speaker
      const dialogues: DialogueLine[] = [];
      let currentDialogue: DialogueLine | null = null;
      
      for (const word of wordsInScene) {
        const speaker = word.speaker || 'UNKNOWN';
        const character = speakerCharacterMap[speaker] || speaker;
        
        // Check face presence for ЗК
        // ВАЖНО: ЗК только если у персонажа ЕСТЬ привязанное лицо И его нет в кадре
        let isOffscreen = false;
        if (faceClusters.length > 0) {
          // Проверяем, есть ли у этого персонажа привязанное лицо
          const characterHasBoundFace = faceClusters.some(fc => fc.characterName === character);
          
          if (characterHasBoundFace) {
            const facePresence = detectFacePresence(
              { startMs: word.startMs, endMs: word.endMs, speakerId: speaker },
              faceClusters,
              new Map(Object.entries(speakerCharacterMap).map(([k, v]) => {
                const faceCluster = faceClusters.find(fc => fc.characterName === v);
                return [faceCluster?.clusterId || k, v];
              }))
            );
            // ЗК только если явно OFFSCREEN (не AMBIGUOUS)
            isOffscreen = facePresence.status === 'OFFSCREEN';
          }
          // Если у персонажа нет привязанного лица — НЕ ставим ЗК (неизвестно)
        }
        
        if (!currentDialogue || currentDialogue.character !== character) {
          if (currentDialogue && currentDialogue.text.trim()) {
            dialogues.push(currentDialogue);
          }
          currentDialogue = {
            character,
            text: word.text,
            isOffscreen,
            startMs: word.startMs,
            endMs: word.endMs,
          };
        } else {
          currentDialogue.text += ' ' + word.text;
          currentDialogue.endMs = word.endMs;
        }
      }
      
      if (currentDialogue && currentDialogue.text.trim()) {
        dialogues.push(currentDialogue);
      }
      
      planDialogues.set(sceneIndex, dialogues);
    }
    
    console.log(`   Built dialogues for ${planDialogues.size} scenes`);
    
    // Log sample dialogues for debugging
    const samplePlans = Array.from(planDialogues.entries()).slice(0, 3);
    if (samplePlans.length > 0) {
      console.log(`\n   📋 Sample dialogues (first 3):`);
      for (const [idx, dialogues] of samplePlans) {
        const scene = scenesInChunk[idx];
        const sample = dialogues.slice(0, 2).map(d => 
          `${d.character}${d.isOffscreen ? ' ЗК' : ''}: "${d.text.slice(0, 50)}..."`
        ).join(', ');
        console.log(`      Plan ${idx + 1} (${scene?.start_timecode}): ${sample || '(нет диалогов)'}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Create montage entries
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n📝 Creating montage entries...`);
    
    let plansCreated = 0;
    
    for (let sceneIndex = 0; sceneIndex < scenesInChunk.length; sceneIndex++) {
      const scene = scenesInChunk[sceneIndex];
      
      // Get Gemini description for this plan (by index)
      const geminiPlan = geminiResponse?.plans?.[sceneIndex];
      
      // Get dialogues for this plan
      const dialogues = planDialogues.get(sceneIndex) || [];
      
      // Format dialogues
      const dialogueText = dialogues
        .map(d => {
          const suffix = d.isOffscreen ? formatPresenceStatus('OFFSCREEN') : '';
          return `${d.character}${suffix}\n${d.text}`;
        })
        .join('\n\n');
      
      // Create entry — use same field names as V4 for compatibility
      // Global plan number = offset + local index + 1
      const planNumber = scenesBeforeThisChunk + sceneIndex + 1;
      const entryData = {
        sheet_id: sheetId,
        plan_number: planNumber,
        order_index: planNumber,
        start_timecode: scene.start_timecode,
        end_timecode: scene.end_timecode,
        plan_type: geminiPlan?.planType || 'Ср.',
        description: geminiPlan?.description || '',
        dialogues: dialogueText || '',
        // V5 metadata (optional columns)
        processing_version: 'v5-beta',
        dialogue_source: 'asr',
        speaker_mapped: dialogues.some(d => !!speakerCharacterMap[d.character]),
      };
      
      // Upsert entry
      const { error: entryError } = await supabase
        .from('montage_entries')
        .upsert(entryData, {
          onConflict: 'sheet_id,plan_number',
        });
      
      if (entryError) {
        console.error(`   ❌ Entry error for plan ${planNumber}:`, entryError);
      } else {
        plansCreated++;
      }
    }
    
    console.log(`   ✅ Created ${plansCreated} entries`);
    
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Chunk ${chunkIndex} complete in ${processingTime}s`);
    console.log(`   Plans created: ${plansCreated}`);
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Trigger next chunk or finalize (with race condition protection)
    // ═══════════════════════════════════════════════════════════════════
    
    // RE-READ fresh state to avoid race conditions
    const { data: freshVideo } = await supabase
      .from('videos')
      .select('chunk_progress_json')
      .eq('id', videoId)
      .single();
    
    const freshProgress = freshVideo?.chunk_progress_json || chunkProgress;
    
    // Update our chunk as completed in fresh state
    freshProgress.chunks[chunkIndex].status = 'completed';
    freshProgress.completedChunks = freshProgress.chunks.filter(
      (c: any) => c.status === 'completed'
    ).length;
    
    // Check for pending chunks
    const pendingChunks = freshProgress.chunks.filter(
      (c: any) => (c.status === 'ready' || c.status === 'pending') && c.storageUrl
    );
    const inProgressChunks = freshProgress.chunks.filter(
      (c: any) => c.status === 'in_progress'
    );
    
    const MAX_CONCURRENT = 3;
    const canTriggerMore = inProgressChunks.length < MAX_CONCURRENT && pendingChunks.length > 0;
    
    if (canTriggerMore) {
      // Trigger next pending chunk (fire-and-forget)
      const nextChunk = pendingChunks[0];
      console.log(`\n🔄 Triggering next chunk ${nextChunk.index + 1} (${pendingChunks.length} pending)...`);
      
      // Mark as in_progress BEFORE saving to prevent race condition
      freshProgress.chunks[nextChunk.index].status = 'in_progress';
    }
    
    // Save updated progress (atomic update)
    await supabase
      .from('videos')
      .update({ chunk_progress_json: freshProgress })
      .eq('id', videoId);
    
    console.log(`   Progress: ${freshProgress.completedChunks}/${freshProgress.totalChunks}`);
    
    // Now trigger if needed (after DB is updated)
    if (canTriggerMore) {
      const nextChunk = pendingChunks[0];
      
      // Build base URL from request
      const requestUrl = new URL(request.url);
      const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
      
      // Fire and forget
      fetch(`${baseUrl}/api/process-chunk-v5`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          chunkIndex: nextChunk.index,
          chunkUrl: nextChunk.storageUrl,
          startTimecode: nextChunk.startTimecode,
          endTimecode: nextChunk.endTimecode,
        }),
      }).catch((err) => {
        console.error(`   ❌ Failed to trigger chunk ${nextChunk.index}:`, err.message);
      });
    }
    
    // Auto-finalize when all chunks are done
    if (chunkProgress.completedChunks === chunkProgress.totalChunks) {
      console.log(`\n🏁 All chunks complete! Finalizing video...`);
      
      try {
        // Update video status
        await supabase
          .from('videos')
          .update({ status: 'completed' })
          .eq('id', videoId);
        
        // Update sheet status
        await supabase
          .from('montage_sheets')
          .update({ status: 'ready' })
          .eq('id', chunkProgress.sheetId);
        
        console.log(`✅ Video finalized successfully!`);
      } catch (finalizeError) {
        console.error(`❌ Finalize error:`, finalizeError);
      }
    }
    
    return NextResponse.json({
      success: true,
      chunkIndex,
      plansCreated,
      processingTime,
      completedChunks: chunkProgress.completedChunks,
      totalChunks: chunkProgress.totalChunks,
    });
    
  } catch (error) {
    console.error('❌ Process chunk V5 error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chunk' },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function parseTimecodeToMs(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  if (parts.length === 4) {
    const [h, m, s, f] = parts;
    return (h * 3600 + m * 60 + s) * 1000 + (f * 1000 / 24);
  }
  return 0;
}

function buildV5Prompt(scenes: MergedScene[], characters: any[]): string {
  const characterList = characters.slice(0, 10).map(c => c.name).join(', ');
  
  return `Ты монтажёр. Проанализируй видео и опиши ВИЗУАЛЬНУЮ ИНФОРМАЦИЮ для каждого плана.

ПЕРСОНАЖИ ИЗ СЦЕНАРИЯ: ${characterList || 'не указаны'}

ВАЖНО: 
- НЕ определяй кто говорит — это делается через аудио-диаризацию!
- Описывай ТОЛЬКО что ВИДНО в кадре
- Определяй тип плана (Кр./Ср./Общ./Деталь)

ПЛАНЫ ДЛЯ АНАЛИЗА:
${scenes.map((s, i) => `План ${i + 1}: ${s.start_timecode} - ${s.end_timecode}`).join('\n')}

ФОРМАТ ОТВЕТА (JSON):
{
  "plans": [
    {
      "planNumber": 1,
      "planType": "Ср.",
      "description": "Женщина в золотом платье стоит у стойки ресепшн",
      "visualCharacters": ["женщина в золотом", "мужчина в костюме"],
      "location": "холл салона"
    }
  ]
}

Ответь ТОЛЬКО JSON, без markdown.`;
}

function parseGeminiOutput(output: any): any {
  try {
    let text = '';
    if (Array.isArray(output)) {
      text = output.join('');
    } else if (typeof output === 'string') {
      text = output;
    } else {
      return { plans: [] };
    }
    
    // Clean markdown
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    
    // Find JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { plans: [] };
  } catch (e) {
    console.error('Failed to parse Gemini output:', e);
    return { plans: [] };
  }
}
