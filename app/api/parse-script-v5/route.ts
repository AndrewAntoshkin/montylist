/**
 * Parse Script V5 API
 * 
 * Детерминированный парсер сценария БЕЗ использования LLM.
 * Использует паттерны для извлечения персонажей и реплик.
 * 
 * @author AI Assistant
 * @version 5.0-beta
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  parseDocxFile,
  parseDocFile,
  parseTxtFile,
  extractCharacterAttributes,
  type ScriptCharacter,
} from '@/lib/script-parser-deterministic';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  console.log('\n' + '═'.repeat(60));
  console.log('📄 PARSE SCRIPT V5 (Deterministic)');
  console.log('═'.repeat(60));
  
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    const filename = file.name.toLowerCase();
    console.log(`   File: ${file.name}`);
    console.log(`   Size: ${(file.size / 1024).toFixed(1)} KB`);
    
    let parsedScript;
    
    if (filename.endsWith('.docx')) {
      // Новый формат Word (.docx)
      const buffer = Buffer.from(await file.arrayBuffer());
      parsedScript = await parseDocxFile(buffer);
    } else if (filename.endsWith('.doc')) {
      // Старый формат Word 97-2003 (.doc)
      console.log(`   Using word-extractor for .doc format`);
      const buffer = Buffer.from(await file.arrayBuffer());
      parsedScript = await parseDocFile(buffer);
    } else if (filename.endsWith('.txt')) {
      const text = await file.text();
      parsedScript = parseTxtFile(text);
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Use .doc, .docx, or .txt' },
        { status: 400 }
      );
    }
    
    // Извлекаем атрибуты для персонажей с описаниями
    for (const char of parsedScript.characters) {
      if (char.description) {
        char.attributes = extractCharacterAttributes(char.description);
      }
    }
    
    // Формируем ответ в формате, совместимом с V4
    const scriptData = {
      title: parsedScript.title,
      characters: parsedScript.characters.map((char: ScriptCharacter) => ({
        name: char.name,
        variants: char.variants,
        dialogueCount: char.dialogueCount,
        firstAppearance: char.firstAppearance,
        description: char.description,
        attributes: char.attributes,
      })),
      lines: parsedScript.lines,
      scenes: parsedScript.scenes || [], // НОВОЕ: сцены с персонажами
      totalLines: parsedScript.lines.length,
      parserVersion: 'v5-deterministic',
    };
    
    console.log(`\n✅ PARSING COMPLETE:`);
    console.log(`   Title: ${scriptData.title}`);
    console.log(`   Characters: ${scriptData.characters.length}`);
    console.log(`   Scenes: ${scriptData.scenes.length}`);
    console.log(`   Lines: ${scriptData.totalLines}`);
    console.log(`   Top characters:`);
    for (const char of scriptData.characters.slice(0, 5)) {
      console.log(`      ${char.name}: ${char.dialogueCount} replicas`);
    }
    
    return NextResponse.json({
      success: true,
      scriptData,
      summary: {
        title: scriptData.title,
        characterCount: scriptData.characters.length,
        lineCount: scriptData.totalLines,
        parserVersion: 'v5-deterministic',
      },
    });
    
  } catch (error) {
    console.error('❌ Parse script error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse script' },
      { status: 500 }
    );
  }
}
