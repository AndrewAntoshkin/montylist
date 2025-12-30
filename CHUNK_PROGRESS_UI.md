# 🎨 UI прогресса обработки по чанкам

## Обзор

Карточки видео теперь показывают детальный прогресс обработки для длинных видео, разбитых на части (чанки).

---

## Дизайн

Карточка "В обработке" показывает:
- 📛 Бейдж "В обработке" (серый)
- 📝 Название файла (серый текст)
- ✅ Список частей с иконками статуса:
  - **✓ Часть N** - завершена (белый текст, иконка галочка)
  - **⏳ Часть N...** - в процессе (серый текст, вращающаяся иконка)
  - **○ Часть N** - ожидает (темно-серый, пустой круг)
- 📅 Дата создания

---

## Технические детали

### 1. База данных

Добавлено поле `chunk_progress_json` в таблицу `videos`:

```sql
chunk_progress_json JSONB -- прогресс обработки чанков
```

Структура JSON:
```json
{
  "totalChunks": 3,
  "completedChunks": 1,
  "currentChunk": 1,
  "chunks": [
    {
      "index": 0,
      "status": "completed",
      "startTimecode": "00:00:00",
      "endTimecode": "00:20:00"
    },
    {
      "index": 1,
      "status": "processing",
      "startTimecode": "00:19:45",
      "endTimecode": "00:39:45"
    },
    {
      "index": 2,
      "status": "pending",
      "startTimecode": "00:39:30",
      "endTimecode": "00:42:43"
    }
  ]
}
```

### 2. Типы TypeScript

Обновлены типы в `types/index.ts`:

```typescript
export interface ChunkProgress {
  totalChunks: number;
  completedChunks: number;
  currentChunk: number;
  chunks: Array<{
    index: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    startTimecode: string;
    endTimecode: string;
  }>;
}

export interface Video {
  // ... existing fields
  chunk_progress?: ChunkProgress;
}
```

### 3. API обновления

`/app/api/process-video-chunked/route.ts` теперь:

1. **Создает initial progress** в начале обработки:
```typescript
const chunkProgress = {
  totalChunks: chunks.length,
  completedChunks: 0,
  currentChunk: 0,
  chunks: chunks.map(chunk => ({
    index: chunk.chunkIndex,
    status: 'pending',
    startTimecode: chunk.startTimecode,
    endTimecode: chunk.endTimecode,
  })),
};

await supabase
  .from('videos')
  .update({ chunk_progress_json: chunkProgress })
  .eq('id', videoId);
```

2. **Обновляет статус** перед обработкой чанка:
```typescript
chunkProgress.currentChunk = chunk.chunkIndex;
chunkProgress.chunks[chunk.chunkIndex].status = 'processing';
await supabase
  .from('videos')
  .update({ chunk_progress_json: chunkProgress })
  .eq('id', videoId);
```

3. **Обновляет после завершения**:
```typescript
chunkProgress.chunks[chunk.chunkIndex].status = 'completed';
chunkProgress.completedChunks++;
await supabase
  .from('videos')
  .update({ chunk_progress_json: chunkProgress })
  .eq('id', videoId);
```

4. **Обновляет при ошибке**:
```typescript
chunkProgress.chunks[chunk.chunkIndex].status = 'failed';
await supabase
  .from('videos')
  .update({ chunk_progress_json: chunkProgress })
  .eq('id', videoId);
```

### 4. UI компонент

`components/VideoCard.tsx` показывает прогресс:

```tsx
{video.chunk_progress && video.chunk_progress.totalChunks > 1 && (
  <div className="flex flex-col gap-3 w-full mt-1">
    {video.chunk_progress.chunks.map((chunk) => (
      <div key={chunk.index} className="flex gap-3 items-center">
        <div className="relative shrink-0 w-[18px] h-[18px]">
          {chunk.status === 'completed' ? (
            <Image src="/icons/check-circle.svg" ... />
          ) : chunk.status === 'processing' ? (
            <Image src="/icons/loading-circle.svg" className="animate-spin" ... />
          ) : (
            <div className="border-2 border-[#3e3e3e] rounded-full" />
          )}
        </div>
        <p className={...}>
          Часть {chunk.index + 1}{chunk.status === 'processing' ? '...' : ''}
        </p>
      </div>
    ))}
  </div>
)}
```

### 5. Dashboard маппинг

`app/dashboard/page.tsx` мапирует JSON на типы:

```typescript
const mappedVideos = (videos || []).map((video: any) => ({
  ...video,
  chunk_progress: video.chunk_progress_json,
})) as Video[];
```

---

## Иконки

Добавлены SVG иконки в `public/icons/`:
- ✅ `check-circle.svg` - для завершенных частей
- ⏳ `loading-circle.svg` - для частей в процессе (с анимацией spin)

---

## Автообновление

Dashboard автоматически обновляется каждые 3 секунды для видео в обработке:

```typescript
// В DashboardClient.tsx
useEffect(() => {
  if (processingVideos.length === 0) return;
  
  const interval = setInterval(() => {
    router.refresh(); // Обновляет данные с сервера
  }, 3000);
  
  return () => clearInterval(interval);
}, [processingVideos.length, router]);
```

---

## Примеры состояний

### Начало обработки (3 чанка):
```
В обработке
Название фильма
○ Часть 1
○ Часть 2  
○ Часть 3
12.11.2025
```

### Обработка первого чанка:
```
В обработке
Название фильма
⏳ Часть 1...
○ Часть 2
○ Часть 3
12.11.2025
```

### Первый чанк завершен:
```
В обработке
Название фильма
✓ Часть 1
⏳ Часть 2...
○ Часть 3
12.11.2025
```

### Все чанки завершены:
```
В обработке (временно, пока не создан лист)
Название фильма
✓ Часть 1
✓ Часть 2
✓ Часть 3
12.11.2025
```

После создания montage sheet → статус меняется на "completed" и карточка становится зеленой.

---

## Отличия от обычных видео

### Обычное видео (<20 минут):
- 1 чанк
- Прогресс НЕ показывается (totalChunks = 1)
- Просто badge "В обработке"

### Длинное видео (>20 минут):
- 2+ чанков
- Прогресс ПОКАЗЫВАЕТСЯ (totalChunks > 1)
- Список всех частей с иконками

---

## Тестирование

### Чтобы увидеть UI прогресса:

1. Запустите проект: `npm run dev`
2. Нажмите "Длинное видео"
3. Загрузите видео > 20 минут (или 40+ минут для 3 чанков)
4. Карточка появится с пустыми кружками
5. По мере обработки кружки заменяются на иконки
6. Dashboard обновляется автоматически каждые 3 секунды

### Для тестирования без реального видео:

Можно вручную обновить `chunk_progress_json` в базе:

```sql
UPDATE videos 
SET chunk_progress_json = '{
  "totalChunks": 3,
  "completedChunks": 1,
  "currentChunk": 1,
  "chunks": [
    {"index": 0, "status": "completed", "startTimecode": "00:00:00", "endTimecode": "00:20:00"},
    {"index": 1, "status": "processing", "startTimecode": "00:19:45", "endTimecode": "00:39:45"},
    {"index": 2, "status": "pending", "startTimecode": "00:39:30", "endTimecode": "00:42:43"}
  ]
}'::jsonb,
status = 'processing'
WHERE id = 'YOUR_VIDEO_ID';
```

---

## Цвета

По дизайну из Figma:

| Элемент | Цвет | Класс |
|---------|------|-------|
| Бейдж фон | #3e3e3e | `bg-[#3e3e3e]` |
| Бейдж текст | #7e7e7e | `text-[#7e7e7e]` |
| Название (processing) | #7e7e7e | `text-[#7e7e7e]` |
| Часть завершена | #ffffff | `text-white` |
| Часть в процессе | #9f9f9f | `text-[#9f9f9f]` |
| Часть ожидает | #5e5e5e | `text-[#5e5e5e]` |
| Дата | #7e7e7e | `text-[#7e7e7e]` |

---

## Файлы изменены

### Новые файлы:
- `public/icons/check-circle.svg` - иконка завершения
- `public/icons/loading-circle.svg` - иконка загрузки
- `CHUNK_PROGRESS_UI.md` - эта документация

### Обновленные файлы:
- `types/index.ts` - добавлен `ChunkProgress` interface
- `components/VideoCard.tsx` - добавлено отображение прогресса
- `app/api/process-video-chunked/route.ts` - сохранение прогресса
- `app/dashboard/page.tsx` - маппинг JSON на типы
- `supabase-migration.sql` - добавлено поле `chunk_progress_json`

---

## Будущие улучшения

1. **WebSocket для real-time обновлений** вместо polling каждые 3 секунды
2. **Процент завершения** внутри чанка (0-100%)
3. **ETA (Estimated Time)** до завершения
4. **Pause/Resume** обработки
5. **Повтор failed чанков** отдельно

---

**UI готов и работает! 🎨✨**




