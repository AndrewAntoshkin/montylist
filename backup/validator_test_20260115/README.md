# Backup: Validator Test (2026-01-15)

Бекап перед реализацией валидатора и Debug UI.

## Файлы

| Файл | Описание |
|------|----------|
| `ai-script-parser.ts` | AI-парсер сценария (Gemini 2.5 Flash) |
| `full-audio-diarization.ts` | Полная диаризация аудио (AssemblyAI) |
| `prompts-v4.ts` | Промпты для Gemini v4 |

## Новые компоненты (добавлены)

| Путь | Описание |
|------|----------|
| `/app/debug/page.tsx` | Debug UI страница |
| `/app/api/videos/route.ts` | API: список видео |
| `/app/api/test/timecodes/route.ts` | Тест: PySceneDetect таймкоды |
| `/app/api/test/diarization/route.ts` | Тест: AssemblyAI диаризация |
| `/app/api/test/scene/route.ts` | Тест: детали сцены |
| `/app/api/test/validate/route.ts` | Валидатор: Gemini собирает данные |

## Как восстановить

```bash
cp backup/validator_test_20260115/*.ts lib/
```

## Версия

- Node.js: 22
- Next.js: 14
- Date: 2026-01-15
