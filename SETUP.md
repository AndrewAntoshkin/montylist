# Carete Montage - Setup Instructions

## Настройка Supabase

### 1. Применение миграции базы данных

1. Откройте ваш проект в Supabase Dashboard: https://goykmdyodqhptkzfgumq.supabase.co
2. Перейдите в **SQL Editor**
3. Создайте новый запрос и скопируйте содержимое файла `supabase-migration.sql`
4. Выполните запрос (Run)

Это создаст:
- Таблицы: `profiles`, `videos`, `montage_sheets`, `montage_entries`
- Row Level Security (RLS) политики для каждой таблицы
- Индексы для оптимизации запросов
- Триггеры для автоматического создания профиля при регистрации

### 2. Настройка Storage Bucket

1. В Supabase Dashboard перейдите в **Storage**
2. Нажмите **Create bucket**
3. Создайте bucket с именем: `videos`
4. Установите следующие настройки:
   - **Public bucket**: No (приватный)
   - **File size limit**: 500 MB (или больше, в зависимости от ваших требований)
   - **Allowed MIME types**: `video/*`

### 3. Настройка Storage Policies

В SQL Editor выполните следующий запрос для настройки политик доступа к Storage:

```sql
-- Allow authenticated users to upload videos
CREATE POLICY "Users can upload own videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to read their own videos
CREATE POLICY "Users can read own videos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow users to delete their own videos
CREATE POLICY "Users can delete own videos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);
```

### 4. Настройка Email Authentication

1. В Supabase Dashboard перейдите в **Authentication** → **Providers**
2. Убедитесь, что **Email** провайдер включен
3. В разделе **Email Templates** можно настроить шаблоны писем для подтверждения email

### 5. Настройка Site URL (для production)

1. Перейдите в **Settings** → **API**
2. В разделе **Site URL** укажите URL вашего приложения (для локальной разработки: `http://localhost:3000`)
3. В **Redirect URLs** добавьте: `http://localhost:3000/auth/callback`

## Запуск приложения

```bash
npm run dev
```

Приложение будет доступно по адресу: http://localhost:3000


