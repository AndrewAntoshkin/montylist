import type { ParsedScene } from '@/types';

/**
 * Parses Gemini's text response into structured montage entries
 * Supports both Markdown and JSON formats
 */
export function parseGeminiResponse(text: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  
  // Try JSON format first (Gemini sometimes returns JSON instead of Markdown)
  const jsonParsed = tryParseJsonScenes(text);
  if (jsonParsed) return jsonParsed;
  
  // Split by timecode sections (e.g., **15:20:30:15 - 15:29:45:20** or **15:20 - 15:29**)
  const timecodeRegex = /\*\*(\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?)\*\*/g;
  
  const sections = text.split(timecodeRegex);
  
  // Process sections in pairs: [text, timecode, content, timecode, content, ...]
  for (let i = 1; i < sections.length; i += 2) {
    const timecode = sections[i].trim();
    const content = sections[i + 1] || '';
    
    const scene = parseScene(timecode, content);
    if (scene) {
      scenes.push(scene);
    }
  }
  
  return scenes;
}

function tryParseJsonScenes(text: string): ParsedScene[] | null {
  const trimmed = (text || '').trim();

  // Case 1: ```json ... ```
  if (trimmed.includes('```json')) {
    console.log('🔍 Detected JSON code block in response, trying JSON parser...');
    try {
      const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[1]);
        const scenes = mapJsonScenes(jsonData);
        if (scenes) {
          console.log(`✅ Successfully parsed ${scenes.length} scenes from JSON block`);
          return scenes;
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to parse JSON code block, falling back to other parsers:', e);
    }
  }

  // Case 2: raw JSON array (sometimes Gemini returns plain JSON without fences)
  if (trimmed.startsWith('[')) {
    console.log('🔍 Detected raw JSON array response, trying JSON parser...');
    try {
      const jsonData = JSON.parse(trimmed);
      const scenes = mapJsonScenes(jsonData);
      if (scenes) {
        console.log(`✅ Successfully parsed ${scenes.length} scenes from raw JSON array`);
        return scenes;
      }
    } catch (e) {
      console.warn('⚠️ Failed to parse raw JSON array, falling back to markdown parser:', e);
    }
  }

  return null;
}

function mapJsonScenes(jsonData: any): ParsedScene[] | null {
  if (!Array.isArray(jsonData)) return null;

  return jsonData.map((scene: any) => {
    const startTimecode = convertJsonTimecode(scene.start);
    const endTimecode = convertJsonTimecode(scene.end);

    return {
      timecode: `${startTimecode} - ${endTimecode}`,
      start_timecode: startTimecode,
      end_timecode: endTimecode,
      plan_type: (scene.plan_type || scene.shot_type || '').trim(),
      description: String(scene.visual_description || scene.content_summary || scene.description || '').trim(),
      dialogues: normalizeDialogueText(String(scene.dialogue || scene.dialogues || '').trim()),
    };
  });
}

function normalizeDialogueText(dialogues: string): string {
  if (!dialogues) return '';

  // Normalize "(ЗК)/(ГЗ)" to " ЗК/ГЗ"
  let out = dialogues.replace(/\s*\((ЗК|ГЗ|ГЗК)\)\b/g, ' $1');

  // Remove "(Имя)" artifacts inside text if any
  out = out.replace(/\(([А-ЯЁ]{2,})\)/g, '$1');

  return out.trim();
}

function parseScene(timecode: string, content: string): ParsedScene | null {
  try {
    // Parse timecode - supports formats:
    // HH:MM:SS:FF (with frames)
    // HH:MM:SS (without frames)
    // MM:SS (short format)
    const timecodeMatch = timecode.match(/(\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?)/);
    if (!timecodeMatch) return null;
    
    const startTimecode = normalizeTimecode(timecodeMatch[1]);
    const endTimecode = normalizeTimecode(timecodeMatch[2]);
    
    // Extract plan type - supports multiple formats:
    // Format 1: **План:** Кр.
    // Format 2: *   **План:** Кр.
    // Format 3 (v2): Вид: Кр. НДП
    const planTypeMatch = content.match(/\*{1,3}\s*\*\*План:\*\*\s*([^\n*]+)/i) ||
                          content.match(/Вид:\s*([^\n]+)/i);
    const planType = planTypeMatch ? planTypeMatch[1].trim() : '';
    
    // Extract "Содержание" field
    // Supports multiple formats:
    // 1. Markdown: *   **Содержание:** текст
    // 2. Plain v2: Содержание: текст (until next field or end)
    let description = '';
    
    // Try markdown format first
    let contentMatch = content.match(/\*{1,3}\s*\*\*Содержание:\*\*\s*([^*]+?)(?=\s*\*{1,3}\s*\*\*|$)/i);
    
    // Try plain format (v2) - everything until "Диалоги:" or "Титр" or end
    if (!contentMatch) {
      contentMatch = content.match(/Содержание:\s*([\s\S]*?)(?=\nДиалоги:|Титр\n|\n\*\*|$)/i);
    }
    
    if (contentMatch) {
      description = contentMatch[1].trim();
      // Clean up
      description = description.replace(/^\*\s+/, '').trim();
      description = description.replace(/\n\s*\n/g, ' ').trim();
      // Remove Gemini numbering artifacts (e.g., "текст 8." or "текст 12.")
      description = description.replace(/\s+\d{1,3}\.?\s*$/g, '').trim();
    }
    
    // Check for "Титр" section - add to description
    const titrMatch = content.match(/Титр\n([\s\S]*?)(?=\nДиалоги:|$)/i);
    if (titrMatch) {
      const titrContent = titrMatch[1].trim();
      if (description) {
        description += '\nТитр\n' + titrContent;
      } else {
        description = 'Титр\n' + titrContent;
      }
    }
    
    // Extract dialogues/sounds 
    // Supports multiple formats:
    // 1. Markdown: **Диалоги/Музыка:** текст
    // 2. Plain v2: Диалоги: ИМЯ\nтекст
    let dialogues = '';
    
    // Try markdown format first
    let dialoguesMatch = content.match(/\*{0,3}\s*\*\*Диалоги\/Музыка:\*\*\s*([\s\S]*?)$/i);
    
    // Try plain format (v2) - "Диалоги:" until end
    if (!dialoguesMatch) {
      dialoguesMatch = content.match(/Диалоги:\s*([\s\S]*?)$/i);
    }
    
    if (dialoguesMatch) {
      dialogues = dialoguesMatch[1].trim();
      
      // Clean up markdown artifacts but preserve line breaks for dialogue format
      dialogues = dialogues.replace(/^\s*-\s*/gm, '').trim();
      dialogues = dialogues.replace(/\*+\s*/g, '').trim(); // Remove asterisks
      
      // Normalize dialogue format: ensure ИМЯ\nтекст format
      // Supports: ИМЯ, ИМЯ ЗК (за кадром), ИМЯ ГЗ (голос за кадром)
      dialogues = dialogues.replace(/([А-ЯЁA-Z]{2,}(?:\s+ЗК|\s+ГЗ|\s+ГЗК)?)\s*\n\s*/g, '$1\n');
      
      // Remove excessive newlines (more than 2)
      dialogues = dialogues.replace(/\n{3,}/g, '\n\n');
      
      // Remove Gemini numbering artifacts (e.g., "текст 8." or "12.")
      dialogues = dialogues.replace(/\s+\d{1,3}\.?\s*$/g, '').trim();
      dialogues = dialogues.replace(/^\d{1,3}\.\s*/gm, ''); // Remove leading numbers like "12. текст"
      
      // Replace "Нет" with "—" (Gemini sometimes outputs this)
      if (dialogues.toLowerCase() === 'нет' || dialogues.match(/^нет\s*\d*\.?\s*$/i)) {
        dialogues = '—';
      }
    }
    
    // FALLBACK: Try old format (individual Диалог/ГЗК/НДП/Музыка fields)
    if (!dialogues) {
      const dialoguesList: string[] = [];
      const dialogueRegex = /\*\*([^:]+):\*\*\s*([^\n*]+)/g;
      let dialogueMatch;
      
      while ((dialogueMatch = dialogueRegex.exec(content)) !== null) {
        const label = dialogueMatch[1].trim();
        const text = dialogueMatch[2].trim();
        
        // Skip "План" and "Содержание" lines
        if (label === 'План' || label === 'Содержание') continue;
        
        // Include only audio content: Диалог, ГЗК, НДП, Музыка
        if (label.includes('Диалог') || label === 'ГЗК' || label === 'НДП' || label === 'Музыка') {
          dialoguesList.push(`${label}: ${text}`);
        }
      }
      dialogues = dialoguesList.join('\n');
    }
    
    // Debug: log first few scenes
    if (timecode.startsWith('00:0') || timecode.startsWith('00:1')) {
      console.log(`📝 Parsed scene ${timecode}:`);
      console.log(`   Plan: "${planType}"`);
      console.log(`   Desc: "${description.substring(0, 80)}${description.length > 80 ? '...' : ''}"`);
      console.log(`   Dialog: "${dialogues.substring(0, 50)}${dialogues.length > 50 ? '...' : ''}"`);
    }
    
    return {
      timecode,
      start_timecode: startTimecode,
      end_timecode: endTimecode,
      plan_type: planType,
      description: description || '',
      dialogues: dialogues || '',
    };
  } catch (error) {
    console.error('Error parsing scene:', error);
    return null;
  }
}

/**
 * Normalizes timecode to HH:MM:SS:FF format (with frames)
 */
function normalizeTimecode(timecode: string): string {
  const parts = timecode.split(':');
  
  if (parts.length === 2) {
    // MM:SS -> 00:MM:SS:00
    return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  } else if (parts.length === 3) {
    // HH:MM:SS -> HH:MM:SS:00
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}:00`;
  } else if (parts.length === 4) {
    // HH:MM:SS:FF -> already correct format
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}:${parts[3].padStart(2, '0')}`;
  }
  
  return timecode;
}

/**
 * Alternative parser for raw line-by-line format
 */
export function parseAlternativeFormat(text: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  const lines = text.split('\n');
  
  let currentScene: Partial<ParsedScene> | null = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Check for timecode line - supports HH:MM:SS:FF or HH:MM:SS or MM:SS
    const timecodeMatch = trimmedLine.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?(?::\d{2})?)/);
    if (timecodeMatch) {
      // Save previous scene if exists
      if (currentScene && currentScene.start_timecode) {
        scenes.push(currentScene as ParsedScene);
      }
      
      // Start new scene
      currentScene = {
        timecode: `${timecodeMatch[1]} - ${timecodeMatch[2]}`,
        start_timecode: normalizeTimecode(timecodeMatch[1]),
        end_timecode: normalizeTimecode(timecodeMatch[2]),
        plan_type: '',
        description: '',
        dialogues: '',
      };
      continue;
    }
    
    // Check for plan type - supports:
    // План: Кр. or Вид: Кр. НДП
    const planMatch = trimmedLine.match(/(?:План|Вид):\s*(.+)/i);
    if (planMatch && currentScene) {
      currentScene.plan_type = planMatch[1].trim();
      continue;
    }
    
    // Check for "Содержание" field - now contains brief description
    const contentMatch = trimmedLine.match(/Содержание:\s*(.+)/i);
    if (contentMatch && currentScene) {
      // Accumulate multi-line content
      if (currentScene.description) {
        currentScene.description += ' ' + contentMatch[1].trim();
      } else {
        currentScene.description = contentMatch[1].trim();
      }
      continue;
    }
    
    // Check for "Титр" line (v2 format) - add to description
    if (trimmedLine === 'Титр' && currentScene) {
      if (currentScene.description) {
        currentScene.description += '\nТитр';
      } else {
        currentScene.description = 'Титр';
      }
      continue;
    }
    
    // If line starts with quoted text or actor name after "Титр", add to description
    if (currentScene && currentScene.description?.includes('Титр') && 
        trimmedLine && !trimmedLine.includes(':') && 
        !trimmedLine.match(/^[А-ЯЁ]{2,}$/)) {
      currentScene.description += '\n' + trimmedLine;
      continue;
    }
    
    // Check for "Диалоги" field (supports both "Диалоги:" and "Диалоги/Музыка:")
    const dialoguesFieldMatch = trimmedLine.match(/Диалоги(?:\/Музыка)?:\s*(.*)/i);
    if (dialoguesFieldMatch && currentScene) {
      const dialogueText = dialoguesFieldMatch[1].trim();
      if (dialogueText) {
        if (currentScene.dialogues) {
          currentScene.dialogues += '\n' + dialogueText;
        } else {
          currentScene.dialogues = dialogueText;
        }
      }
      continue;
    }
    
    // Check for character name line (all caps, possibly with ЗК) - add to dialogues
    if (currentScene && trimmedLine.match(/^[А-ЯЁA-Z]{2,}(?:\s+ЗК|\s+ГЗ|\s+ГЗК)?$/) && !trimmedLine.includes(':')) {
      if (currentScene.dialogues) {
        currentScene.dialogues += '\n' + trimmedLine;
      } else {
        currentScene.dialogues = trimmedLine;
      }
      continue;
    }
    
    // If previous line was a character name, this is their dialogue text
    if (currentScene && currentScene.dialogues && 
        currentScene.dialogues.match(/[А-ЯЁA-Z]{2,}(?:\s+ЗК|\s+ГЗ|\s+ГЗК)?$/) &&
        trimmedLine && !trimmedLine.match(/^(Вид|Содержание|Диалоги|Титр):/i)) {
      currentScene.dialogues += '\n' + trimmedLine;
      continue;
    }
    
    // FALLBACK: Check for old-style dialogue markers
    if ((trimmedLine.includes('ГЗК:') || trimmedLine.includes('НДП:') || 
         trimmedLine.includes('Диалог') || trimmedLine.includes('Музыка:')) && currentScene) {
      if (currentScene.dialogues) {
        currentScene.dialogues += '\n' + trimmedLine;
      } else {
        currentScene.dialogues = trimmedLine;
      }
    }
  }
  
  // Save last scene
  if (currentScene && currentScene.start_timecode) {
    scenes.push(currentScene as ParsedScene);
  }
  
  return scenes;
}

/**
 * Converts JSON timecode into standard HH:MM:SS:FF format.
 *
 * Supports:
 * - HH:MM:SS:FF (already frame timecode) → normalized
 * - HH:MM:SS or MM:SS → adds :00 frames
 * - HH:MM:SS.mmm / 00:00:00.00 → drops ms and adds :00 frames
 */
function convertJsonTimecode(timecode: string): string {
  if (!timecode) return '00:00:00:00';
  
  // Remove milliseconds if present (00:00:00.00 → 00:00:00)
  const withoutMs = timecode.split('.')[0];
  
  // If it's already HH:MM:SS:FF, just normalize/pad
  const tcParts = withoutMs.split(':');
  if (tcParts.length === 4) {
    return `${tcParts[0].padStart(2, '0')}:${tcParts[1].padStart(2, '0')}:${tcParts[2].padStart(2, '0')}:${tcParts[3].padStart(2, '0')}`;
  }

  // Ensure HH:MM:SS format, then add :00 frames
  while (tcParts.length < 3) {
    tcParts.unshift('00'); // Add missing hours/minutes
  }
  
  // Add frame placeholder :00
  return `${tcParts.join(':')}:00`;
}
