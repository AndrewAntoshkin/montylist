import type { ParsedScene } from '@/types';

/**
 * Parses Gemini's text response into structured montage entries
 */
export function parseGeminiResponse(text: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  
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
    
    // Extract plan type - supports both formats:
    // Format 1: **План:** Кр.
    // Format 2: *   **План:** Кр.
    const planTypeMatch = content.match(/\*{1,3}\s*\*\*План:\*\*\s*([^\n*]+)/i);
    const planType = planTypeMatch ? planTypeMatch[1].trim() : '';
    
    // Extract "Содержание" field
    // Supports inline format: *   **Содержание:** текст.
    let description = '';
    const contentMatch = content.match(/\*{1,3}\s*\*\*Содержание:\*\*\s*([^*]+?)(?=\s*\*{1,3}\s*\*\*|$)/is);
    if (contentMatch) {
      description = contentMatch[1].trim();
      // Clean up
      description = description.replace(/^\*\s+/, '').trim();
      description = description.replace(/\n\s*\n/g, ' ').trim();
    }
    
    // Extract dialogues/sounds 
    // Supports inline format: *   **Диалоги/Музыка:** текст.
    let dialogues = '';
    const dialoguesMatch = content.match(/\*{1,3}\s*\*\*Диалоги\/Музыка:\*\*\s*([^*]+?)(?=\s*\*{1,3}\s*\*\*|$)/is);
    if (dialoguesMatch) {
      dialogues = dialoguesMatch[1].trim();
      // Clean up formatting
      dialogues = dialogues.replace(/^\s*-\s*/gm, '').trim();
      dialogues = dialogues.replace(/\n\s*\n/g, ' ').trim();
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
    
    // Check for plan type - NEW FORMAT: План: Кр.
    const planMatch = trimmedLine.match(/План:\s*(.+)/i);
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
    
    // Check for "Диалоги/Музыка" field
    const dialoguesFieldMatch = trimmedLine.match(/Диалоги\/Музыка:\s*(.+)/i);
    if (dialoguesFieldMatch && currentScene) {
      if (currentScene.dialogues) {
        currentScene.dialogues += '\n' + dialoguesFieldMatch[1].trim();
      } else {
        currentScene.dialogues = dialoguesFieldMatch[1].trim();
      }
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


