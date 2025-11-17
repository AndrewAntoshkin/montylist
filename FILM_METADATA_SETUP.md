# Настройка метаданных фильма

## Обзор

Добавлена функциональность двухшаговой загрузки фильма:
1. **Шаг 1**: Форма "Детали фильма" - заполнение метаданных фильма
2. **Шаг 2**: Загрузка видео файла

## Что было сделано

### 1. Типы и интерфейсы
- Добавлен интерфейс `FilmMetadata` в `/types/index.ts`
- Добавлено поле `film_metadata` в интерфейс `Video`

### 2. Компоненты
- **`FilmDetailsModal.tsx`** - модальное окно с формой деталей фильма (пиксель-перфект дизайн из Figma)
- **`TwoStepUploadModal.tsx`** - обертка для двухшагового процесса
- **`UploadModal.tsx`** - обновлен для поддержки передачи метаданных

### 3. API
- **`/api/upload/route.ts`** - обновлен для сохранения метаданных в БД
- **`/api/export-doc/[videoId]/route.ts`** - обновлен для подстановки данных в Word документ
- **`/api/export/[videoId]/route.ts`** - обновлен для подстановки данных в Excel файл

### 4. База данных
- Создан файл миграции `add-film-metadata-column.sql`

## Применение миграции базы данных

### Вариант 1: Через Supabase Dashboard (рекомендуется)

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите ваш проект
3. Перейдите в **SQL Editor**
4. Откройте файл `add-film-metadata-column.sql`
5. Скопируйте содержимое и вставьте в редактор
6. Нажмите **Run** или **Ctrl+Enter**

### Вариант 2: Через CLI

```bash
# Убедитесь, что вы залогинены в Supabase CLI
supabase login

# Примените миграцию
supabase db push --db-url "your-database-url"
```

### Вариант 3: Вручную через psql

```bash
psql "your-database-connection-string" -f add-film-metadata-column.sql
```

## Структура метаданных фильма

Метаданные хранятся в поле `film_metadata_json` (JSONB) и включают:

```typescript
{
  producer_company?: string;      // Фирма-производитель
  release_year?: string;          // Год выпуска
  country?: string;               // Страна производства
  screenwriter?: string;          // Автор (ы) сценария
  director?: string;              // Режиссер-постановщик
  copyright_holder?: string;      // Правообладатель (и)
  duration_text?: string;         // Продолжительность фильма
  episodes_count?: string;        // Количество серий
  frame_format?: string;          // Формат кадра
  color_format?: string;          // Цветной / черно-белый
  media_carrier?: string;         // Носитель информации
  original_language?: string;     // Язык оригинала
  subtitles_language?: string;    // Язык надписей
  audio_language?: string;        // Язык фонограммы
}
```

## Использование

### Загрузка видео с метаданными

1. Пользователь нажимает "Новый лист"
2. Открывается форма "Данные фильма"
3. Пользователь может:
   - **Заполнить форму** и нажать "Продолжить" → метаданные сохраняются
   - **Нажать "Пропустить"** → загружается без метаданных (как раньше)
   - **Нажать "Отмена"** → закрыть форму
4. После первого шага открывается стандартная форма загрузки видео

### Экспорт с метаданными

При экспорте в Excel или Word:
- Если метаданные заполнены → они отображаются в документе
- Если метаданные пусты → показываются пустые поля

## Проверка установки

После применения миграции проверьте:

```sql
-- Проверка наличия колонки
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'videos' 
  AND column_name = 'film_metadata_json';

-- Проверка индекса
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'videos' 
  AND indexname = 'idx_videos_film_metadata';
```

## Откат изменений (если необходимо)

```sql
-- Удалить индекс
DROP INDEX IF EXISTS idx_videos_film_metadata;

-- Удалить колонку
ALTER TABLE videos DROP COLUMN IF EXISTS film_metadata_json;
```

## Примечания

- Все поля метаданных опциональные
- Метаданные хранятся в формате JSONB для гибкости
- Добавлен GIN индекс для быстрого поиска по метаданным
- Старые видео без метаданных продолжат работать нормально

