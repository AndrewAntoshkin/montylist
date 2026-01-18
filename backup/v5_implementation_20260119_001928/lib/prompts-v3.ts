/**
 * Промпты v3 — МАКСИМАЛЬНО УПРОЩЁННЫЕ
 * 
 * Философия: FFmpeg определяет таймкоды, AI описывает содержание.
 * Минимум инструкций — модель работает лучше когда её не перегружают.
 */

/**
 * Форматирует персонажей из сценария для промпта
 */
export function formatCharactersForPrompt(
  characters: Array<{ name: string; gender?: string; description?: string; dialogueCount?: number }>
): string {
  if (!characters || characters.length === 0) return '';
  
  // Главные персонажи (5+ реплик)
  const main = characters.filter(c => (c.dialogueCount || 0) >= 5);
  // Второстепенные (2-4 реплики)
  const secondary = characters.filter(c => (c.dialogueCount || 0) >= 2 && (c.dialogueCount || 0) < 5);
  
  const lines: string[] = ['ПЕРСОНАЖИ (используй эти имена!):'];
  
  if (main.length > 0) {
    lines.push('Главные:');
    for (const c of main.slice(0, 10)) {
      const gender = c.gender === 'female' ? '♀' : c.gender === 'male' ? '♂' : '';
      const desc = c.description ? ` — ${c.description}` : '';
      lines.push(`  • ${c.name} ${gender}${desc}`);
    }
  }
  
  if (secondary.length > 0) {
    lines.push('Второстепенные: ' + secondary.slice(0, 10).map(c => c.name).join(', '));
  }
  
  return lines.join('\n');
}

/**
 * ОСНОВНОЙ ПРОМПТ v3 — простой и эффективный
 * 
 * FFmpeg даёт таймкоды — AI описывает что видит и слышит.
 * Формат markdown — надёжнее JSON.
 */
export function createPromptV3(
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  characterRegistry: string = ''
): string {
  const sceneList = scenes
    .map((s, i) => `${i + 1}. ${s.start_timecode} - ${s.end_timecode}`)
    .join('\n');

  return `Создай монтажный лист для ${scenes.length} планов.

ТАЙМКОДЫ ФИКСИРОВАНЫ (от FFmpeg) — не меняй их, просто опиши каждый:

${sceneList}
${characterRegistry ? `\n${characterRegistry}\n` : ''}
ДЛЯ КАЖДОГО ПЛАНА НАПИШИ (используй ТОЧНО эти таймкоды из списка!):

**START_TIMECODE - END_TIMECODE**
План: [Кр./Ср./Общ./Деталь] [+ НДП если есть титры]
Содержание: [Кто в кадре, что делает. Если титры — укажи текст]
Диалоги: [ИМЯ (имя на отдельной строке)
текст реплики] или "Музыка"

ПРИМЕР:
**00:01:06:13 - 00:01:09:09**
План: Ср. НДП
Содержание: Тома идет по салону.
Титр: Галина – Полина Нечитайло
Диалоги: ТОМА
Проходите, присаживайтесь.

**00:01:09:09 - 00:01:12:15**
План: Кр.
Содержание: Галя садится на кушетку.
Диалоги: ГАЛЯ
Спасибо.

ПРАВИЛА:
1. Пиши ТОЛЬКО то что видишь и слышишь в ЭТОМ КОНКРЕТНОМ отрезке времени!
2. ДИАЛОГИ — СТРОГО по таймкодам:
   - Слушай ТОЛЬКО звук между START и END таймкодом
   - Если в этом отрезке персонаж МОЛЧИТ — пиши "Музыка"
   - НЕ переноси реплики с соседних планов!
   - Реплика должна НАЧИНАТЬСЯ в этом отрезке
3. Формат диалогов: ИМЯ на отдельной строке, потом текст (БЕЗ двоеточия)
4. Если персонаж говорит за кадром — добавь ЗК после имени (ГАЛЯ ЗК)
5. Описывай ВСЕ ${scenes.length} планов!`;
}

/**
 * Промпт для НАЧАЛА видео (первый чанк)
 * Может содержать логотип и заставку — их нужно объединить
 */
export function createOpeningPromptV3(
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  characterRegistry: string = ''
): string {
  const sceneList = scenes
    .map((s, i) => `${i + 1}. ${s.start_timecode} - ${s.end_timecode}`)
    .join('\n');

  return `Создай монтажный лист для НАЧАЛА видео (${scenes.length} склеек от FFmpeg).

СКЛЕЙКИ:
${sceneList}
${characterRegistry ? `\n${characterRegistry}\n` : ''}
ОСОБЕННОСТИ НАЧАЛА ВИДЕО:

1. **ЛОГОТИП** (первые 2-10 сек) — опиши как ОДИН план:
   План: НДП
   Содержание: Логотип. [Название студии/канала]
   Диалоги: Музыка

2. **ЗАСТАВКА** (обычно 30-90 сек) — опиши как ОДИН план:
   План: Ср. НДП
   Содержание: Заставка.
   Титр: [Канал] представляет.
   Титр: [Имя персонажа. Актёр]
   [Перечисли ВСЕ титры!]
   Название: [Название фильма]
   Диалоги: Музыка

3. **ПОСЛЕ ЗАСТАВКИ** — каждая склейка = отдельный план (как обычно)

ФОРМАТ ОТВЕТА (используй ТОЧНО таймкоды из списка СКЛЕЙКИ!):

**START_TIMECODE - END_TIMECODE**
План: [тип]
Содержание: [описание]
Диалоги: [ИМЯ
текст] или Музыка

ПРИМЕР:
**00:00:00:00 - 00:00:04:09**
План: НДП
Содержание: Логотип. Телекомпания Партнер.
Диалоги: Музыка

**00:00:04:09 - 00:01:06:13**
План: Ср. НДП
Содержание: Заставка.
Титр: Телеканал Домашний представляет.
Титр: Шурочка — Татьяна Рыбинец.
Титр: Бэлла — Полина Ганшина.
Название: Любовь и прочие глупости
Диалоги: Музыка

**00:01:06:13 - 00:01:09:09**
План: Ср. НДП
Содержание: Тома идет по салону.
Титр: Галина – Полина Нечитайло
Диалоги: ТОМА
Проходите, присаживайтесь.

Начинай!`;
}

/**
 * Промпт для ФИНАЛЬНЫХ ТИТРОВ (последний чанк если есть титры)
 */
export function createClosingCreditsPromptV3(
  startTimecode: string,
  endTimecode: string
): string {
  return `Опиши ФИНАЛЬНЫЕ ТИТРЫ как ОДИН план.

**${startTimecode} - ${endTimecode}**
План: НДП
Содержание: Титры.
[Перечисли всех из съёмочной группы:]
режиссёр-постановщик: ИМЯ
автор сценария: ИМЯ
оператор: ИМЯ
[и т.д.]
Диалоги: Музыка`;
}

/**
 * Промпт для чанка с контекстом
 */
export function createChunkPromptV3(
  scenes: Array<{ start_timecode: string; end_timecode: string }>,
  chunkIndex: number,
  totalChunks: number,
  isFirstChunk: boolean,
  isLastChunk: boolean,
  characterRegistry: string = ''
): string {
  // Для первого чанка используем специальный промпт
  if (isFirstChunk && chunkIndex === 0) {
    return createOpeningPromptV3(scenes, characterRegistry);
  }
  
  // Для обычных чанков — стандартный промпт
  let prompt = createPromptV3(scenes, characterRegistry);
  
  // Добавляем информацию о позиции
  if (totalChunks > 1) {
    prompt += `\n\nЭто часть ${chunkIndex + 1} из ${totalChunks}.`;
  }
  
  return prompt;
}

/**
 * Парсер ответа v3 — markdown формат
 * 
 * Парсит ответ вида:
 * **00:01:06:13 - 00:01:09:09**
 * План: Ср. НДП
 * Содержание: Тома идет по салону.
 * Диалоги: ТОМА
 * Проходите.
 */
export function parseResponseV3(response: string): Array<{
  start_timecode: string;
  end_timecode: string;
  plan_type: string;
  description: string;
  dialogues: string;
}> {
  const results: Array<{
    start_timecode: string;
    end_timecode: string;
    plan_type: string;
    description: string;
    dialogues: string;
  }> = [];
  
  // Разбиваем по блокам, начинающимся с **таймкод - таймкод**
  // Поддерживаем разные форматы:
  // - **00:00:00:00 - 00:00:06:04** (с кадрами)
  // - **00:00:00 - 00:00:06** (без кадров)
  // - Разные тире: - – —
  const blocks = response.split(/\*\*(\d{2}:\d{2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{2}:\d{2}:\d{2}(?::\d{2})?)\*\*/);
  
  // blocks[0] — текст до первого таймкода (пропускаем)
  // blocks[1] — start_timecode
  // blocks[2] — end_timecode  
  // blocks[3] — содержимое блока
  // blocks[4] — следующий start_timecode и т.д.
  
  for (let i = 1; i < blocks.length; i += 3) {
    let startTimecode = blocks[i];
    let endTimecode = blocks[i + 1];
    const content = blocks[i + 2] || '';
    
    // Нормализуем таймкоды — добавляем :00 кадров если нет
    if (startTimecode && startTimecode.split(':').length === 3) {
      startTimecode += ':00';
    }
    if (endTimecode && endTimecode.split(':').length === 3) {
      endTimecode += ':00';
    }
    
    if (!startTimecode || !endTimecode) continue;
    
    // Парсим содержимое блока
    const planMatch = content.match(/План:\s*(.+?)(?:\n|$)/i);
    const contentMatch = content.match(/Содержание:\s*([\s\S]*?)(?=Диалоги:|$)/i);
    const dialoguesMatch = content.match(/Диалоги:\s*([\s\S]*?)(?=\*\*|$)/i);
    
    results.push({
      start_timecode: startTimecode.trim(),
      end_timecode: endTimecode.trim(),
      plan_type: planMatch ? planMatch[1].trim() : 'Ср.',
      description: contentMatch ? contentMatch[1].trim() : '',
      dialogues: dialoguesMatch ? dialoguesMatch[1].trim() : 'Музыка',
    });
  }
  
  return results;
}

