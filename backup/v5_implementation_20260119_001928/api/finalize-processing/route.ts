import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deduplicateScenes } from '@/lib/video-chunking';
import { validateMontageEntries } from '@/lib/validate-montage';
import { validateTimecodeSequence, analyzeGapPattern } from '@/lib/timecode-validator';
import { createValidationPrompt } from '@/lib/gemini-prompt-simple';
import { createPredictionWithRetry, pollPrediction } from '@/lib/replicate-helper';
import { getReplicatePool } from '@/lib/replicate-pool';
import { processCharacters } from '@/lib/character-processor';
import { validateAllChunks, getChunksForRetry } from '@/lib/chunk-validator';
import { validateMontageSheet, fixMontageSheet, formatValidationReport, type MontageEntry } from '@/lib/final-validator';
import { type CharacterRegistry } from '@/lib/character-registry';
import { mergeRoleSpeakersToNames } from '@/lib/entity-merge';

const AI_MODEL = 'google/gemini-3-pro';

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
    // Check chunk_progress_json status (may be stale due to parallel updates)
    const completedChunksFromStatus = chunkProgress.chunks.filter((chunk: any) =>
      chunk.status === 'completed'
    );
    
    console.log(`📊 Chunks marked completed in JSON: ${completedChunksFromStatus.length}/${chunkProgress.chunks.length}`);

    // Also count ACTUAL entries in database per chunk as backup
    // (more reliable than JSON status due to race conditions in parallel processing)
    const { data: entryCounts, error: countError } = await supabase
      .from('montage_entries')
      .select('chunk_index')
      .eq('sheet_id', chunkProgress.sheetId);

    let actualCompletedChunks = completedChunksFromStatus.length;
    if (!countError && entryCounts) {
      const chunksWithEntries = new Set(entryCounts.map((e: any) => e.chunk_index));
      actualCompletedChunks = Math.max(completedChunksFromStatus.length, chunksWithEntries.size);
      console.log(`📊 Chunks with actual entries in DB: ${chunksWithEntries.size} (chunks: ${[...chunksWithEntries].join(', ')})`);
    }

    const completionRate = actualCompletedChunks / chunkProgress.chunks.length;
    console.log(`📊 Completion rate: ${actualCompletedChunks}/${chunkProgress.chunks.length} (${(completionRate * 100).toFixed(0)}%)`);

    // Lowered threshold to 30% - parallel processing may cause JSON status race conditions
    // but actual entries in DB are the source of truth
    if (completionRate < 0.3) {
      // Less than 30% completed - reject finalization
      const pendingChunks = chunkProgress.chunks.filter((chunk: any) =>
        chunk.status !== 'completed'
      );
      return NextResponse.json(
        {
          error: 'Not enough chunks completed (need at least 30%)',
          completedChunks: actualCompletedChunks,
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

    // ════════════════════════════════════════════════════════════════
    // ШАГ 1: Удаляем пустые планы (start = end, нулевая длительность)
    // ════════════════════════════════════════════════════════════════
    
    let cleanedEntries = entries || [];
    
    if (entries && entries.length > 0) {
      // Фильтруем пустые планы
      const emptyPlans = entries.filter((e: any) => e.start_timecode === e.end_timecode);
      
      if (emptyPlans.length > 0) {
        console.log(`🗑️  Found ${emptyPlans.length} empty plans (start=end), removing...`);
        cleanedEntries = entries.filter((e: any) => e.start_timecode !== e.end_timecode);
        
        // Удаляем пустые планы из базы
        const emptyIds = emptyPlans.map((e: any) => e.id);
        if (emptyIds.length > 0) {
          const { error: deleteEmptyError } = await supabase
            .from('montage_entries')
            .delete()
            .in('id', emptyIds);
          
          if (deleteEmptyError) {
            console.error('Error deleting empty plans:', deleteEmptyError);
          } else {
            console.log(`✅ Deleted ${emptyIds.length} empty plans`);
          }
        }
      }
    }
    
    // ════════════════════════════════════════════════════════════════
    // ШАГ 2: Сортируем по таймкоду (критически важно!)
    // ════════════════════════════════════════════════════════════════
    
    if (cleanedEntries.length > 0) {
      // Сортируем по start_timecode
      cleanedEntries.sort((a: any, b: any) => {
        const aTime = a.start_timecode || '00:00:00:00';
        const bTime = b.start_timecode || '00:00:00:00';
        return aTime.localeCompare(bTime);
      });
      console.log(`📊 Sorted ${cleanedEntries.length} entries by timecode`);
    }
    
    // ════════════════════════════════════════════════════════════════
    // ШАГ 3: Дедупликация (удаляем дубли между чанками)
    // ════════════════════════════════════════════════════════════════
    
    // Deduplicate scenes (removes overlaps between chunks)
    let deduplicatedEntries = cleanedEntries;
    
    if (cleanedEntries.length > 0) {
      deduplicatedEntries = deduplicateScenes(cleanedEntries);
      console.log(`📊 After deduplication: ${deduplicatedEntries.length} entries`);

      // If we removed duplicates, update the database
      if (deduplicatedEntries.length < cleanedEntries.length) {
        // Get IDs to keep
        const idsToKeep = new Set(deduplicatedEntries.map(e => e.id));
        const idsToDelete = cleanedEntries
          .filter((e: any) => !idsToKeep.has(e.id))
          .map((e: any) => e.id);

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

        // IMPORTANT: keep in-memory entries consistent for subsequent validation steps
        // (otherwise strict validation will report massive numbering issues).
        deduplicatedEntries = deduplicatedEntries.map((e: any, idx: number) => ({
          ...e,
          plan_number: idx + 1,
          order_index: idx + 1,
        }));
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ШАГ 4: Нормализация таймкодов (end_timecode встык с next start)
    // ════════════════════════════════════════════════════════════════
    if (deduplicatedEntries.length > 1) {
      console.log('\n📐 Normalizing timecodes (встык format)...');
      let normalizedCount = 0;
      
      for (let i = 0; i < deduplicatedEntries.length - 1; i++) {
        const current = deduplicatedEntries[i];
        const next = deduplicatedEntries[i + 1];
        
        // Если end текущего != start следующего, выравниваем
        if (current.end_timecode !== next.start_timecode) {
          const oldEnd = current.end_timecode;
          current.end_timecode = next.start_timecode;
          normalizedCount++;
          
          // Обновляем в базе данных
          await supabase
            .from('montage_entries')
            .update({ end_timecode: next.start_timecode })
            .eq('id', current.id);
        }
      }
      
      if (normalizedCount > 0) {
        console.log(`✅ Normalized ${normalizedCount} timecodes to встык format`);
      } else {
        console.log('✅ All timecodes already in встык format');
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ШАГ 5: Заполнение пустых описаний
    // ════════════════════════════════════════════════════════════════
    if (deduplicatedEntries.length > 0) {
      console.log('\n📝 Checking for empty descriptions...');
      let emptyDescCount = 0;
      
      for (let i = 0; i < deduplicatedEntries.length; i++) {
        const entry = deduplicatedEntries[i];
        const desc = entry.description?.trim() || '';
        
        // Пустое или placeholder описание
        if (!desc || desc === '[Требует описания]' || desc.length < 3) {
          emptyDescCount++;
          
          // Генерируем описание на основе контекста
          let newDescription = '';
          
          // Пробуем взять из соседних планов
          const prevEntry = i > 0 ? deduplicatedEntries[i - 1] : null;
          const nextEntry = i < deduplicatedEntries.length - 1 ? deduplicatedEntries[i + 1] : null;
          
          // Если есть предыдущий план с персонажем — используем его
          if (prevEntry?.description) {
            const charMatch = prevEntry.description.match(/^([А-ЯЁ][а-яё]+)/);
            if (charMatch) {
              newDescription = `${charMatch[1]} в кадре.`;
            }
          }
          
          // Fallback — общее описание на основе типа плана
          if (!newDescription) {
            const planType = entry.plan_type?.toLowerCase() || '';
            if (planType.includes('кр')) {
              newDescription = 'Крупный план.';
            } else if (planType.includes('ср')) {
              newDescription = 'Средний план.';
            } else if (planType.includes('общ')) {
              newDescription = 'Общий план.';
            } else if (planType.includes('дет')) {
              newDescription = 'Деталь.';
            } else {
              newDescription = 'Кадр.';
            }
          }
          
          entry.description = newDescription;
          
          // Обновляем в базе данных
          await supabase
            .from('montage_entries')
            .update({ description: newDescription })
            .eq('id', entry.id);
        }
      }
      
      if (emptyDescCount > 0) {
        console.log(`✅ Filled ${emptyDescCount} empty descriptions`);
      } else {
        console.log('✅ No empty descriptions found');
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ШАГ 5.5: Нормализация имён и удаление фейковых звуков
    // ════════════════════════════════════════════════════════════════
    if (deduplicatedEntries.length > 0) {
      console.log('\n📝 Normalizing names and cleaning fake sounds...');
      
      // Словарь полные → короткие имена
      const FULL_TO_SHORT: Record<string, string> = {
        'ГАЛИНА': 'ГАЛЯ',
        'ТАТЬЯНА': 'ТАНЯ',
        'СВЕТЛАНА': 'СВЕТА',
        'ЕЛЕНА': 'ЛЕНА',
        'ВАЛЕНТИНА': 'ВАЛЯ',
        'НАДЕЖДА': 'НАДЯ',
        'МАРИЯ': 'МАША',
        'ЕКАТЕРИНА': 'КАТЯ',
        'ЛЮДМИЛА': 'ЛЮДАСЯ',
        'ТАМАРА': 'ТОМА',
        'ВЛАДИМИР': 'ВОВЧИК',
      };
      
      // Фейковые звуки для удаления
      const FAKE_SOUNDS = [
        '[Шаги]', '[Звук шагов]', '[Шум одежды]', '[Вздох]', '[Звук воды]',
        '[Пауза]', '[Фоновая музыка ресторана]', '[Шум ресторана]', '[Шум]',
        '[Тишина]', '[Молчание]', '[Звук]', '[Фон]', '[Фоновые звуки]',
        '[Шорох]', '[Скрип]', '[Стук]', '[Звонок]', 'УСМЕХАЕТСЯ',
      ];
      
      let namesFixedCount = 0;
      let soundsFixedCount = 0;
      
      for (const entry of deduplicatedEntries) {
        let dialogues = entry.dialogues || '';
        let description = entry.description || '';
        let needsUpdate = false;
        
        // A. Заменяем полные имена на короткие
        for (const [full, short] of Object.entries(FULL_TO_SHORT)) {
          const regexUpper = new RegExp(`\\b${full}\\b`, 'g');
          const fullCapitalized = full.charAt(0) + full.slice(1).toLowerCase();
          const shortCapitalized = short.charAt(0) + short.slice(1).toLowerCase();
          const regexCapitalized = new RegExp(`\\b${fullCapitalized}\\b`, 'g');
          
          if (regexUpper.test(dialogues) || regexCapitalized.test(dialogues)) {
            dialogues = dialogues.replace(regexUpper, short);
            dialogues = dialogues.replace(regexCapitalized, shortCapitalized);
            needsUpdate = true;
            namesFixedCount++;
          }
          
          if (regexUpper.test(description) || regexCapitalized.test(description)) {
            description = description.replace(regexUpper, short);
            description = description.replace(regexCapitalized, shortCapitalized);
            needsUpdate = true;
          }
        }
        
        // B. Удаляем фейковые звуки
        for (const sound of FAKE_SOUNDS) {
          const regex = new RegExp(sound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          if (regex.test(dialogues)) {
            dialogues = dialogues.replace(regex, '').trim();
            needsUpdate = true;
            soundsFixedCount++;
          }
        }
        
        // Если после очистки осталась пустая строка — ставим "Музыка"
        if (!dialogues || dialogues === '...' || dialogues === '—' || dialogues.length < 2) {
          dialogues = 'Музыка';
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          entry.dialogues = dialogues;
          entry.description = description;
          
          await supabase
            .from('montage_entries')
            .update({ dialogues, description })
            .eq('id', entry.id);
        }
      }
      
      if (namesFixedCount > 0 || soundsFixedCount > 0) {
        console.log(`✅ Fixed ${namesFixedCount} full names → short, removed ${soundsFixedCount} fake sounds`);
      } else {
        console.log('✅ Names and sounds already clean');
      }
    }

    // 🔍 CHUNK QUALITY VALIDATION
    // Проверяем качество каждого чанка и определяем нужен ли retry
    console.log('\n🔍 Running chunk quality validation...');
    const chunkValidation = validateAllChunks(deduplicatedEntries, chunkProgress);
    
    console.log(`📊 Chunk validation: ${chunkValidation.validChunks}/${chunkValidation.totalChunks} valid`);
    
    if (chunkValidation.chunksNeedingRetry.length > 0) {
      console.log(`⚠️  ${chunkValidation.chunksNeedingRetry.length} chunks may benefit from retry:`);
      
      const chunksToRetry = getChunksForRetry(chunkValidation, 3); // Max 3 retries
      
      for (const chunk of chunksToRetry) {
        console.log(`   - Chunk ${chunk.chunkIndex} (${chunk.startTimecode} - ${chunk.endTimecode}): ${chunk.retryReason}`);
        for (const issue of chunk.issues) {
          console.log(`     ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.description}`);
        }
      }
      
      // Логируем все issues для анализа
      const issuesByType = new Map<string, number>();
      for (const issue of chunkValidation.allIssues) {
        issuesByType.set(issue.type, (issuesByType.get(issue.type) || 0) + 1);
      }
      
      console.log(`\n📊 Issue summary:`);
      for (const [type, count] of issuesByType) {
        console.log(`   - ${type}: ${count}`);
      }
    } else {
      console.log('✅ All chunks passed quality validation!');
    }

    // ════════════════════════════════════════════════════════════════
    // ШАГ 3.5: ENTITY MERGE (роль → имя) по описаниям
    // Универсально и безопасно: меняем только ROLE-speaker, и только если описание
    // явно содержит ровно одно известное имя и это подтверждено несколько раз.
    // ════════════════════════════════════════════════════════════════
    {
      const characterRegistry: CharacterRegistry | null = chunkProgress.characterRegistry || null;
      const { entries: mergedEntries, replacements, mappings } = mergeRoleSpeakersToNames(
        deduplicatedEntries,
        characterRegistry,
        { minConfirmations: 2 }
      );

      if (replacements > 0) {
        console.log(`\n🧩 Entity merge: replaced ${replacements} role-speakers with names`);
        mappings.slice(0, 10).forEach(m => {
          console.log(`   - ${m.role} → ${m.name} (${m.confirmations} подтверждений)`);
        });

        // Persist only changed dialogues
        for (let i = 0; i < mergedEntries.length; i++) {
          const before = deduplicatedEntries[i];
          const after = mergedEntries[i];
          if (before?.id && after?.dialogues !== before?.dialogues) {
            await supabase
              .from('montage_entries')
              .update({ dialogues: after.dialogues })
              .eq('id', before.id);
          }
        }
      }

      deduplicatedEntries = mergedEntries;
    }

    // ════════════════════════════════════════════════════════════════
    // ШАГ 4: ЖЁСТКАЯ ВАЛИДАЦИЯ (новый модуль)
    // ════════════════════════════════════════════════════════════════
    
    console.log('\n🔍 Running STRICT validation...');
    
    // Получаем characterRegistry из chunk_progress
    const characterRegistry: CharacterRegistry | null = chunkProgress.characterRegistry || null;
    if (characterRegistry?.characters?.length) {
      console.log(`🎭 Using ${characterRegistry.characters.length} characters from registry`);
    }
    
    // Преобразуем в MontageEntry для валидатора
    const entriesForValidation: MontageEntry[] = deduplicatedEntries.map((e: any) => ({
      id: e.id,
      plan_number: e.plan_number,
      start_timecode: e.start_timecode,
      end_timecode: e.end_timecode,
      plan_type: e.plan_type,
      description: e.description,
      dialogues: e.dialogues,
    }));
    
    const strictValidation = validateMontageSheet(entriesForValidation, characterRegistry);
    console.log(formatValidationReport(strictValidation));
    
    // Если есть ошибки — пытаемся автоисправить
    if (!strictValidation.isValid || strictValidation.issues.length > 0) {
      console.log('🔧 Attempting auto-fix...');
      const fixResult = fixMontageSheet(entriesForValidation, characterRegistry);
      
      if (fixResult.deletedIds.length > 0) {
        console.log(`   🗑️ Deleting ${fixResult.deletedIds.length} empty plans`);
        await supabase
          .from('montage_entries')
          .delete()
          .in('id', fixResult.deletedIds);
      }
      
      if (fixResult.renumbered) {
        console.log(`   🔢 Renumbering ${fixResult.fixed.length} plans`);
        for (const entry of fixResult.fixed) {
          await supabase
            .from('montage_entries')
            .update({ plan_number: entry.plan_number, order_index: entry.order_index ?? entry.plan_number })
            .eq('id', entry.id);
        }
      }
      
      if (fixResult.characterReplacements > 0) {
        console.log(`   🎭 Replaced ${fixResult.characterReplacements} generic character names`);
        for (const entry of fixResult.fixed) {
          const original = deduplicatedEntries.find((e: any) => e.id === entry.id);
          if (original && original.dialogues !== entry.dialogues) {
            await supabase
              .from('montage_entries')
              .update({ dialogues: entry.dialogues })
              .eq('id', entry.id);
          }
        }
      }
      
      console.log(`✅ Auto-fix complete`);
    }

    // 🎭 CHARACTER POST-PROCESSING (legacy - для совместимости)
    console.log('\n🎭 Running character post-processing...');
    
    // Получаем characterMemory из chunk_progress если есть (legacy)
    const characterMemory = chunkProgress.characterMemory;
    if (characterMemory?.characters?.length > 0) {
      console.log(`🎭 Using ${characterMemory.characters.length} characters from legacy memory`);
    }
    
    const characterResult = processCharacters(deduplicatedEntries);
    
    if (characterResult.characters.length > 0) {
      console.log(`✅ Found ${characterResult.characters.length} characters in titles`);
      
      // Обновляем записи в базе если были замены
      if (characterResult.replacements > 0) {
        console.log(`🔄 Updating ${characterResult.replacements} entries with character names...`);
        
        // Получаем обновлённые entries после замен
        const { entries: updatedWithCharacters } = await (async () => {
          const { replaceUnknownCharacters } = await import('@/lib/character-processor');
          return replaceUnknownCharacters(deduplicatedEntries, characterResult.characters);
        })();
        
        // Обновляем в базе
        for (const entry of updatedWithCharacters) {
          const original = deduplicatedEntries.find((e: any) => e.id === entry.id);
          if (original && (original.dialogues !== entry.dialogues || original.description !== entry.description)) {
            await supabase
              .from('montage_entries')
              .update({ 
                dialogues: entry.dialogues,
                description: entry.description 
              })
              .eq('id', entry.id);
          }
        }
        
        console.log(`✅ Updated entries with character names`);
      }
    }
    
    if (characterResult.warnings.length > 0) {
      characterResult.warnings.forEach(w => console.warn(w));
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

    // 🆕 AI ВАЛИДАЦИЯ готового монтажного листа
    console.log('\n🤖 Running AI validation...');
    
    try {
      const aiValidationResult = await runAIValidation(finalEntries, validation.warnings);
      
      if (aiValidationResult) {
        console.log(`🤖 AI Validation score: ${aiValidationResult.score}/100`);
        console.log(`🤖 AI Summary: ${aiValidationResult.summary}`);
        
        if (aiValidationResult.issues && aiValidationResult.issues.length > 0) {
          console.log(`🤖 AI found ${aiValidationResult.issues.length} issues:`);
          aiValidationResult.issues.slice(0, 5).forEach((issue: any) => {
            console.log(`   Plan ${issue.planNumber}: ${issue.issue}`);
          });
          
          // Автоматически исправляем простые проблемы (формат диалогов)
          if (aiValidationResult.issues.length <= 20) {
            console.log(`\n🔧 Attempting to auto-fix ${aiValidationResult.issues.length} issues...`);
            const fixedCount = await autoFixIssues(supabase, sheetId, aiValidationResult.issues, finalEntries);
            console.log(`✅ Auto-fixed ${fixedCount} issues`);
          }
        } else {
          console.log(`✅ AI validation passed - no issues found!`);
        }
      }
    } catch (aiError) {
      // AI валидация не критична - продолжаем даже если она упала
      console.warn(`⚠️ AI validation failed (non-critical):`, aiError);
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

/**
 * Запускает AI валидацию готового монтажного листа
 */
async function runAIValidation(
  entries: any[],
  existingWarnings: string[]
): Promise<{
  isValid: boolean;
  score: number;
  issues: Array<{ planNumber: number; issue: string; fix?: string }>;
  summary: string;
} | null> {
  if (entries.length === 0) return null;
  
  // Берём образец планов для валидации (первые 10, средние 10, последние 10)
  const sampleSize = Math.min(10, Math.floor(entries.length / 3));
  const samplePlans = [
    ...entries.slice(0, sampleSize),
    ...entries.slice(Math.floor(entries.length / 2) - sampleSize / 2, Math.floor(entries.length / 2) + sampleSize / 2),
    ...entries.slice(-sampleSize)
  ].map(e => ({
    plan_number: e.plan_number,
    start_timecode: e.start_timecode,
    end_timecode: e.end_timecode,
    plan_type: e.plan_type,
    dialogues: e.dialogues,
    description: e.description,
  }));

  const prompt = createValidationPrompt(entries.length, samplePlans, existingWarnings.slice(0, 5));
  
  // Получаем клиент Replicate
  const pool = getReplicatePool();
  const { client: replicate, release } = await pool.getLeastLoadedClient();
  
  try {
    console.log(`🤖 Sending ${samplePlans.length} sample plans for validation...`);
    
    const prediction = await createPredictionWithRetry(
      replicate,
      AI_MODEL,
      { prompt }
    );
    
    const completedPrediction = await pollPrediction(replicate, prediction.id, 30, 3000);
    
    if (completedPrediction.status !== 'succeeded') {
      throw new Error(`Validation prediction failed: ${completedPrediction.error}`);
    }
    
    const output = completedPrediction.output;
    const responseText = Array.isArray(output) ? output.join('') : String(output);
    
    // Парсим JSON из ответа
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.warn(`⚠️ Failed to parse AI validation JSON:`, parseError);
        return null;
      }
    }
    
    return null;
  } finally {
    release();
  }
}

/**
 * Автоматически исправляет простые проблемы в монтажном листе
 */
async function autoFixIssues(
  supabase: any,
  sheetId: string,
  issues: Array<{ planNumber: number; issue: string; fix?: string }>,
  entries: any[]
): Promise<number> {
  let fixedCount = 0;
  
  for (const issue of issues) {
    const entry = entries.find(e => e.plan_number === issue.planNumber);
    if (!entry) continue;
    
    let needsUpdate = false;
    const updates: any = {};
    
    // Исправляем формат диалогов (двоеточие после имени)
    if (issue.issue.toLowerCase().includes('двоеточ') && entry.dialogues) {
      const fixedDialogues = entry.dialogues
        .replace(/^([А-ЯЁ]+):\s*/gm, '$1\n') // ТОМА: текст → ТОМА\nтекст
        .replace(/\(([А-ЯЁа-яё]+)\)/g, '$1'); // (Тома) → Тома
      
      if (fixedDialogues !== entry.dialogues) {
        updates.dialogues = fixedDialogues;
        needsUpdate = true;
      }
    }
    
    // Исправляем титры в одну строку
    if (issue.issue.toLowerCase().includes('титр') && entry.description) {
      const fixedDescription = entry.description
        .replace(/Титр\s+([А-ЯЁа-яё]+\s*[–-]\s*[А-ЯЁа-яё\s]+)\s*Титр/g, 'Титр\n$1\nТитр');
      
      if (fixedDescription !== entry.description) {
        updates.description = fixedDescription;
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      const { error } = await supabase
        .from('montage_entries')
        .update(updates)
        .eq('id', entry.id);
      
      if (!error) {
        fixedCount++;
      }
    }
  }
  
  return fixedCount;
}

