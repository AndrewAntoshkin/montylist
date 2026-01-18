/**
 * AI-парсер сценария
 * 
 * Использует Gemini для извлечения персонажей и их описаний
 * из сценария ЛЮБОГО формата — без хардкода!
 * 
 * ВАЖНО: Используем простой текстовый формат вместо JSON,
 * потому что Gemini часто возвращает невалидный JSON.
 */

import Replicate from 'replicate';

export interface AIExtractedCharacter {
  name: string;                    // Имя персонажа (ГАЛИНА, ЮСЕФ)
  shortName?: string;              // Краткое имя (ГАЛЯ, ЮСЯ)
  description: string;             // Описание внешности
  age?: number;                    // Возраст (если указан)
  gender: 'male' | 'female' | 'unknown';
  role: 'main' | 'secondary' | 'episodic' | 'extra';  // Роль в фильме
  profession?: string;             // Профессия/род занятий
}

export interface AIScriptParseResult {
  title?: string;
  characters: AIExtractedCharacter[];
  totalScenes: number;
  parseTime: number;
}

// Промпт ТОЧНО как работал напрямую с Gemini (28 персонажей)
const EXTRACT_CHARACTERS_PROMPT = `Проанализируй этот сценарий и найди ВСЕХ персонажей с их описаниями внешности.

Задача:
1. Найди ВСЕХ персонажей — главных, второстепенных, эпизодических, массовку
2. Ищи персонажей везде: в списке действующих лиц, в ремарках, в диалогах
3. Для каждого собери ВСЕ описания внешности из любого места сценария
4. Обрати внимание на первое появление — там обычно есть описание

Верни результат в ТАКОМ ФОРМАТЕ (каждый персонаж через ---):

ПЕРСОНАЖ: [имя как в сценарии]
КРАТКОЕ_ИМЯ: [если есть]
ПОЛ: мужской/женский
РОЛЬ: главная/второстепенная/эпизодическая
ОПИСАНИЕ: [все описания внешности, возраст, одежда]
---

ВАЖНО:
- Формат строгий: КЛЮЧ: значение
- Каждый персонаж отделён строкой ---
- Найди ВСЕХ, даже тех кто появляется один раз
- Не пропускай никого!

СЦЕНАРИЙ:
`;

/**
 * Парсит текстовый ответ Gemini в структурированные данные
 */
function parseTextResponse(text: string): AIExtractedCharacter[] {
  const characters: AIExtractedCharacter[] = [];
  
  // Разбиваем по разделителю --- (разные варианты формата)
  // Может быть: \n---\n, ---\n, \n---, или просто ---
  let blocks = text.split(/\n*-{3,}\n*/).filter(b => b.trim() && /ПЕРСОНАЖ:/i.test(b));
  
  console.log(`   📄 Split by '---': found ${blocks.length} character blocks`);
  
  // Если не нашли блоки — пробуем по ПЕРСОНАЖ:
  if (blocks.length === 0) {
    const personPattern = /(?=ПЕРСОНАЖ:\s*)/gi;
    blocks = text.split(personPattern).filter(b => b.trim() && /ПЕРСОНАЖ:/i.test(b));
    console.log(`   📄 Fallback split by 'ПЕРСОНАЖ:': found ${blocks.length} blocks`);
  }
  
  for (const block of blocks) {
    const char: Partial<AIExtractedCharacter> = {
      gender: 'unknown',
      role: 'secondary',
      description: '',
    };
    
    // Парсим каждое поле
    const персонажMatch = block.match(/ПЕРСОНАЖ:\s*(.+)/i);
    const краткоеMatch = block.match(/КРАТКОЕ_ИМЯ:\s*(.+)/i);
    const полMatch = block.match(/ПОЛ:\s*(.+)/i);
    const рольMatch = block.match(/РОЛЬ:\s*(.+)/i);
    
    // ОПИСАНИЕ — берём всё после "ОПИСАНИЕ:" до конца блока
    const описаниеMatch = block.match(/ОПИСАНИЕ:\s*([\s\S]*)/i);
    
    if (персонажMatch) {
      char.name = персонажMatch[1].trim().toUpperCase();
    }
    
    if (краткоеMatch) {
      const value = краткоеMatch[1].trim();
      if (value && value.toLowerCase() !== 'нет' && value !== '-' && value !== 'пусто') {
        char.shortName = value;
      }
    }
    
    if (полMatch) {
      const value = полMatch[1].toLowerCase();
      if (value.includes('муж')) char.gender = 'male';
      else if (value.includes('жен')) char.gender = 'female';
      // 'смешанный' остаётся 'unknown'
    }
    
    if (рольMatch) {
      const value = рольMatch[1].toLowerCase();
      if (value.includes('глав')) char.role = 'main';
      else if (value.includes('второ')) char.role = 'secondary';
      else if (value.includes('эпизод')) char.role = 'episodic';
      else if (value.includes('массов')) char.role = 'extra';
    }
    
    if (описаниеMatch) {
      char.description = описаниеMatch[1].trim();
    } else {
      // Fallback: берём всё после ОПИСАНИЕ: до конца блока
      const descMatch = block.match(/ОПИСАНИЕ:\s*(.+)/i);
      if (descMatch) {
        const descStart = block.indexOf(descMatch[0]);
        const descText = block.slice(descStart + 'ОПИСАНИЕ:'.length).trim();
        
        // Обрезаем если есть следующее поле
        const nextFieldMatch = descText.match(/\n(ПЕРСОНАЖ|КРАТКОЕ_ИМЯ|ПОЛ|РОЛЬ|ПРОФЕССИЯ|ВОЗРАСТ):/i);
        if (nextFieldMatch) {
          char.description = descText.slice(0, nextFieldMatch.index).trim();
        } else {
          // Убираем --- в конце если есть
          char.description = descText.replace(/\n\s*-{2,}\s*$/, '').trim();
        }
      }
    }
    
    // Добавляем только если есть имя
    if (char.name && char.name.length > 1) {
      characters.push(char as AIExtractedCharacter);
    }
  }
  
  return characters;
}

/**
 * Извлекает персонажей из сценария с помощью AI
 */
export async function parseScriptWithAI(
  scriptText: string,
  options: {
    model?: string;
    maxChars?: number;
    token?: string;
  } = {}
): Promise<AIScriptParseResult> {
  const startTime = Date.now();
  const {
    model = 'google/gemini-2.5-flash',
    maxChars = 100000,  // Увеличено! Gemini 2.5 поддерживает до 1M токенов
    token = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN_1,
  } = options;
  
  if (!token) {
    console.error('❌ No REPLICATE_API_TOKEN found');
    return { characters: [], totalScenes: 0, parseTime: Date.now() - startTime };
  }
  
  // Обрезаем сценарий если слишком большой
  let textToSend = scriptText;
  if (scriptText.length > maxChars) {
    const halfMax = Math.floor(maxChars / 2);
    textToSend = scriptText.slice(0, halfMax) + 
      '\n\n... [ПРОПУЩЕНА СЕРЕДИНА СЦЕНАРИЯ] ...\n\n' + 
      scriptText.slice(-halfMax);
    console.log(`   ⚠️ Script truncated: ${scriptText.length} → ${textToSend.length} chars`);
  }
  
  const prompt = EXTRACT_CHARACTERS_PROMPT + textToSend;
  
  console.log(`\n🤖 AI SCRIPT PARSER: Extracting characters with ${model}...`);
  console.log(`   📝 Script length: ${textToSend.length} chars`);
  
  try {
    const replicate = new Replicate({ auth: token });
    
    const prediction = await replicate.predictions.create({
      model,
      input: {
        prompt,
        max_output_tokens: 65535,  // Максимум для полного списка персонажей
        temperature: 1,            // Default как в Gemini Studio
        top_p: 0.95,               // Default как в Gemini Studio
        thinking_budget: 8000,     // Даём время на анализ всего сценария
      },
    });
    
    // Ждём результата
    let result = await replicate.predictions.get(prediction.id);
    let attempts = 0;
    const maxAttempts = 60;
    
    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await replicate.predictions.get(prediction.id);
      attempts++;
    }
    
    if (result.status === 'failed') {
      throw new Error(`Prediction failed: ${result.error}`);
    }
    
    const output = Array.isArray(result.output) ? result.output.join('') : String(result.output);
    
    // Логируем сырой ответ для диагностики
    console.log(`   📄 Raw output length: ${output.length} chars`);
    console.log(`   📄 Output preview (first 300 chars): ${output.slice(0, 300).replace(/\n/g, '\\n')}`);
    
    // Считаем сколько блоков персонажей в ответе
    const blockCount = (output.match(/---/g) || []).length;
    console.log(`   📄 Found ${blockCount} '---' separators in output`);
    
    // Парсим текстовый ответ
    const characters = parseTextResponse(output);
    
    if (characters.length === 0) {
      console.error('❌ No characters found in AI response');
      console.error('   Raw output (first 1000 chars):', output.slice(0, 1000));
      return { characters: [], totalScenes: 0, parseTime: Date.now() - startTime };
    }
    
    // Проверка на неполный ответ: длинный скрипт должен иметь много персонажей
    const expectedMinChars = textToSend.length > 50000 ? 15 : 
                             textToSend.length > 20000 ? 8 : 3;
    
    if (characters.length < expectedMinChars && blockCount < expectedMinChars) {
      console.warn(`   ⚠️ AI returned only ${characters.length} characters for ${textToSend.length} char script (expected ${expectedMinChars}+)`);
      console.warn(`   ⚠️ This may be a truncated response from Gemini. Consider re-running.`);
    }
    
    const parseTime = Date.now() - startTime;
    console.log(`   ✅ Found ${characters.length} characters in ${parseTime}ms`);
    
    for (const char of characters.slice(0, 10)) {
      const roleIcon = char.role === 'main' ? '🌟' : char.role === 'secondary' ? '👤' : '👥';
      console.log(`   ${roleIcon} ${char.name}${char.shortName ? ` (${char.shortName})` : ''}: ${char.description?.slice(0, 50) || '[нет описания]'}...`);
    }
    
    return { characters, totalScenes: 0, parseTime };
    
  } catch (error) {
    console.error('❌ AI Script Parser error:', error);
    return { characters: [], totalScenes: 0, parseTime: Date.now() - startTime };
  }
}

/**
 * Конвертирует результат AI-парсинга в формат ScriptCharacter
 */
export function convertToScriptCharacters(aiResult: AIScriptParseResult): Array<{
  name: string;
  normalizedName: string;
  dialogueCount: number;
  description?: string;
  gender?: 'male' | 'female' | 'unknown';
  variants: string[];
}> {
  return aiResult.characters.map(char => {
    const dialogueCount = char.role === 'main' ? 50 : 
                          char.role === 'secondary' ? 15 : 
                          char.role === 'episodic' ? 3 : 1;
    
    const variants = [char.name];
    if (char.shortName && char.shortName.toUpperCase() !== char.name) {
      variants.push(char.shortName.toUpperCase());
    }
    
    let description = char.description || '';
    if (char.profession && !description.toLowerCase().includes(char.profession.toLowerCase())) {
      description = `${char.profession}. ${description}`;
    }
    
    return {
      name: char.name.toUpperCase(),
      normalizedName: (char.shortName || char.name).toUpperCase(),
      dialogueCount,
      description,
      gender: char.gender,
      variants,
    };
  });
}
