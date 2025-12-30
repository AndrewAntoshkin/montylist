# 🚀 Параллельная обработка v2: Gemini 2.5 Pro + 3-минутные чанки

## 📊 Что изменилось

| Параметр | Было | Стало |
|----------|------|-------|
| **Модель** | Gemini 2.5 Flash | **Gemini 3 Pro** |
| **Размер чанка** | 1 минута | **3 минуты** |
| **Overlap** | 5 секунд | **15 секунд** |
| **Обработка** | Последовательная | **Параллельная (10 чанков)** |
| **Post-processing** | Нет | **Распознавание персонажей из титров** |
| **Валидация** | Базовая | **Умная с selective retry** |

## 🏗️ Новая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    PIPELINE v2                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. INIT: Разбивка на 3-минутные чанки (15 сек overlap)         │
│     └── Загрузка → FFmpeg split → Upload chunks                 │
│                                                                  │
│  2. PARALLEL: Batch обработка по 10 чанков                      │
│     ┌────────────────────────────────────────┐                  │
│     │  Batch 1: chunks 0-9   → Gemini 3 Pro  │                  │
│     │  Batch 2: chunks 10-19 → Gemini 3 Pro  │                  │
│     │  ...                                   │                  │
│     └────────────────────────────────────────┘                  │
│     ⏱️ ~3-5 мин на батч (вместо 30-45 мин последовательно)      │
│                                                                  │
│  3. RETRY: Автоматический retry до 3 failed чанков              │
│                                                                  │
│  4. MERGE + DEDUPLICATE: Склейка результатов                    │
│                                                                  │
│  5. CHARACTER POST-PROCESSING:                                  │
│     ├── Извлечение имён из титров                               │
│     │   "Галина – Полина Нечитайло" → ГАЛЯ                      │
│     └── Замена "ЖЕНЩИНА" → "ГАЛЯ" после первого появления       │
│                                                                  │
│  6. CHUNK QUALITY VALIDATION:                                   │
│     ├── Проверка пустых диалогов                                │
│     ├── Проверка gaps в таймкодах                               │
│     └── Логирование проблемных чанков                           │
│                                                                  │
│  7. AI VALIDATION: Финальная проверка через Gemini              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Изменённые файлы

### 1. `lib/video-chunking.ts`
- CHUNK_DURATION: 60 → **180 секунд (3 минуты)**
- OVERLAP_DURATION: 5 → **15 секунд**

### 2. `app/api/process-chunk/route.ts`
- Модель: `gemini-2.5-flash` → **`gemini-3-pro`**

### 3. `app/api/process-all-chunks/route.ts`
- **Параллельная обработка**: батчи по 10 чанков
- **Automatic retry**: до 3 failed чанков

### 4. `app/api/finalize-processing/route.ts`
- **Chunk quality validation**: проверка качества каждого чанка
- **Character post-processing**: замена placeholder-ов на имена

### 5. `lib/gemini-prompt-simple.ts` (НОВЫЙ промпт)
- Улучшенные инструкции по распознаванию персонажей
- Чёткие правила формата диалогов
- Примеры с титрами

## 🆕 Новые файлы

### `lib/character-processor.ts`
Модуль post-processing персонажей:
- `extractCharactersFromTitles()` - извлечение из титров
- `replaceUnknownCharacters()` - замена placeholder-ов
- Маппинг полных имён: Галина → ГАЛЯ, Татьяна → ТАНЯ

### `lib/chunk-validator.ts`
Модуль валидации качества чанков:
- `validateChunkQuality()` - проверка одного чанка
- `validateAllChunks()` - проверка всех чанков
- Типы issues: empty_dialogues, unknown_characters, gaps, etc.

## 🎯 Ожидаемые улучшения

### Скорость
- **45-минутное видео**: ~10-15 мин (было 30-45 мин)
- Параллельная обработка 10 чанков одновременно

### Качество
- **Gemini 3 Pro**: Новейшая модель, обогнала GPT-5 Pro в 19/20 бенчмарках
- **3-минутные чанки**: больше контекста для модели
- **15 сек overlap**: меньше потерь на стыках
- **Post-processing персонажей**: автоматическая замена "ЖЕНЩИНА" на реальные имена

### Надёжность
- **Retry mechanism**: автоматический retry failed чанков
- **Chunk validation**: обнаружение проблем до финализации
- **Detailed logging**: полная информация о каждом шаге

## 📊 Исследование (на основе чего принимались решения)

### Источники
1. [Google Video Understanding Best Practices](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding)
2. [Gemini Video Timestamp Issues Discussion](https://discuss.ai.google.dev/t/gemini-2-5-pro-severe-timestamp-timecode-jumping-issues-in-video-transcription-need-workarounds/87242)
3. [Building Scalable Audio Transcription Pipeline](https://dsssolutions.com/2025/04/29/building-a-scalable-and-accurate-audio-interview-transcription-pipeline-with-google-gemini/)

### Ключевые находки
- **3-5 минутные чанки** рекомендуются для лучшей точности таймкодов
- **Overlapping segments** снижают drift до 5-10 секунд за час
- **Gemini 2.5 Pro**: 73.7% accuracy на Video OCR
- **Параллельная обработка**: подтверждена практикой Disney/NVIDIA

## 🧪 Тестирование

```bash
# Запустить сервер
npm run dev

# Загрузить видео через UI
# Проверить логи в терминале
```

### Что проверять в логах:
```
📦 Processing batch 1/3 (10 chunks in parallel)
   Chunks: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
   ✅ Chunk 0: 45 scenes
   ✅ Chunk 1: 38 scenes
   ...
   
🎭 Character post-processing...
   Found 5 characters in titles:
   - ГАЛЯ (Галина) by Полина Нечитайло at plan 15
   - ТОМА (Тамара) by Анна Татаренко at plan 23
   Made 12 replacements

🔍 Chunk quality validation...
   Chunk validation: 15/15 valid
   ✅ All chunks passed quality validation!
```

## ⚠️ Известные ограничения

1. **Gemini timestamp issues**: могут быть небольшие скачки таймкодов
2. **Character recognition**: работает только если есть титры с именами
3. **Cost**: Gemini 3 Pro дороже чем Flash

## 🔮 Возможные улучшения (TODO)

1. [ ] Retry для конкретных проблемных чанков через API
2. [ ] Кеширование результатов чанков
3. [ ] UI для отображения проблемных чанков
4. [ ] Manual character mapping через UI



