import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseScript, formatCharactersForGeminiPrompt } from '@/lib/script-parser';
import type { ScriptData } from '@/types';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * API для парсинга сценария
 * Принимает файл (DOCX или TXT) и возвращает извлечённых персонажей
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'Файл не загружен' },
        { status: 400 }
      );
    }

    // Проверяем формат файла
    const filename = file.name.toLowerCase();
    const validExtensions = ['.doc', '.docx', '.txt'];
    const hasValidExtension = validExtensions.some(ext => filename.endsWith(ext));

    if (!hasValidExtension) {
      return NextResponse.json(
        { error: `Неподдерживаемый формат. Используйте: ${validExtensions.join(', ')}` },
        { status: 400 }
      );
    }

    // Проверяем размер (макс 10 MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимум 10 MB' },
        { status: 400 }
      );
    }

    console.log(`📄 Parsing script: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    // Читаем файл в буфер
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Парсим сценарий
    const parsedScript = await parseScript(buffer, file.name);

    // Формируем данные для клиента
    const scriptData: ScriptData = {
      title: parsedScript.title,
      characters: parsedScript.characters.map(c => ({
        name: c.name,
        normalizedName: c.normalizedName,
        dialogueCount: c.dialogueCount,
        gender: c.gender,
        variants: c.variants,
        description: c.description,  // Описание внешности из сценария
      })),
      sceneCount: parsedScript.scenes.length,
      format: parsedScript.format,
      uploadedAt: new Date().toISOString(),
    };

    // Формируем промпт для Gemini
    const characterPrompt = formatCharactersForGeminiPrompt(parsedScript.characters);

    console.log(`✅ Script parsed successfully:`);
    console.log(`   - Title: ${scriptData.title || 'не определено'}`);
    console.log(`   - Scenes: ${scriptData.sceneCount}`);
    console.log(`   - Characters: ${scriptData.characters.length}`);
    console.log(`   - Format: ${scriptData.format}`);

    return NextResponse.json({
      success: true,
      scriptData,
      characterPrompt,
      summary: {
        title: scriptData.title,
        sceneCount: scriptData.sceneCount,
        characterCount: scriptData.characters.length,
        mainCharacters: scriptData.characters
          .filter(c => c.dialogueCount >= 5)
          .map(c => c.name),
      },
    });

  } catch (error) {
    console.error('Error parsing script:', error);
    return NextResponse.json(
      { 
        error: 'Ошибка при парсинге сценария',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

