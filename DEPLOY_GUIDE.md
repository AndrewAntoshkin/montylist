# 🚀 Развертывание приложения Monty

## Вариант 1: Vercel (Рекомендуется для Next.js) ⭐

### Шаг 1: Подготовка проекта

1. Убедитесь что все изменения закоммичены:
```bash
git add .
git commit -m "Add email templates and assets"
git push origin main
```

### Шаг 2: Развертывание на Vercel

1. Перейдите на [vercel.com](https://vercel.com)
2. Войдите через GitHub
3. Нажмите **"Add New Project"**
4. Выберите репозиторий `carete-montage`
5. Настройки оставьте по умолчанию (Vercel автоматически определит Next.js)
6. Добавьте Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = ваш Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = ваш Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = ваш Supabase service role key
   - `REPLICATE_API_TOKEN` = ваш Replicate API token
7. Нажмите **"Deploy"**

### Шаг 3: Получите URL

После развертывания Vercel даст вам URL типа:
```
https://carete-montage.vercel.app
```

### Шаг 4: Настройте Supabase

1. В Supabase Dashboard → **Authentication** → **URL Configuration**
2. **Site URL**: `https://carete-montage.vercel.app`
3. **Redirect URLs**: добавьте `https://carete-montage.vercel.app/auth/callback`

### Шаг 5: Настройте Email Template

В Supabase Email Template используйте URL:
```html
<img src="https://carete-montage.vercel.app/icons/monty-logo.svg" />
<img src="https://carete-montage.vercel.app/email-bg.png" />
<img src="https://carete-montage.vercel.app/icons/monty-logo-small.svg" />
```

---

## Вариант 2: Изображения в Supabase Storage 📦

Если хотите хранить изображения отдельно:

### Шаг 1: Создайте публичный bucket

1. В Supabase → **Storage** → **Create bucket**
2. Название: `email-assets`
3. **Public bucket**: ✅ включите

### Шаг 2: Загрузите изображения

Загрузите в bucket:
- `monty-logo.svg`
- `monty-logo-small.svg`
- `email-bg.png`

### Шаг 3: Получите публичные URL

Для каждого файла кликните → **Get public URL**

Пример:
```
https://your-project.supabase.co/storage/v1/object/public/email-assets/monty-logo.svg
```

### Шаг 4: Обновите email template

Используйте эти публичные URL в email шаблоне.

---

## Вариант 3: Netlify (Альтернатива Vercel)

### Шаг 1: Подготовка

Создайте файл `netlify.toml`:
```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

### Шаг 2: Развертывание

1. Перейдите на [netlify.com](https://netlify.com)
2. Войдите через GitHub
3. **Add new site** → **Import an existing project**
4. Выберите репозиторий
5. Добавьте те же Environment Variables
6. Deploy

---

## ⚠️ Важные моменты

### FFmpeg для видео

Для обработки видео на сервере нужен FFmpeg. 

**Vercel:**
- Используйте `@ffmpeg-installer/ffmpeg` (уже в package.json)
- Работает автоматически

**Альтернатива:**
- Можно обрабатывать видео в браузере через `ffmpeg.wasm`
- Или использовать внешний сервис

### База данных

Supabase уже в облаке - дополнительная настройка не нужна.

### Домен

После развертывания можете добавить свой домен:
- В Vercel: **Settings** → **Domains**
- В Netlify: **Domain settings** → **Add domain**

---

## 🎉 Готово!

После развертывания:
1. ✅ Приложение доступно по HTTPS
2. ✅ Изображения в email работают
3. ✅ API routes функционируют
4. ✅ Автоматический деплой при push в main

## 🔥 Быстрый старт (Vercel CLI)

```bash
# Установите Vercel CLI
npm i -g vercel

# Войдите
vercel login

# Разверните
vercel

# Добавьте environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add REPLICATE_API_TOKEN

# Production deploy
vercel --prod
```

