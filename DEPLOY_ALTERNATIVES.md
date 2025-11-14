# 🌍 Альтернативные способы деплоя (если Vercel недоступен)

## 🎯 Быстрые и простые варианты:

---

## 1. Railway.app ⭐ (Рекомендуется)

**Плюсы:** Очень простой, есть бесплатный план, без блокировок по региону

### Шаги:

1. **Перейдите на [railway.app](https://railway.app)**
2. **Sign up** через GitHub (или email)
3. **New Project** → **Deploy from GitHub repo**
4. Выберите `carete-montage`
5. Railway автоматически определит Next.js
6. **Добавьте переменные окружения:**
   - Нажмите на проект → **Variables**
   - Добавьте:
     ```
     NEXT_PUBLIC_SUPABASE_URL=ваш-url
     NEXT_PUBLIC_SUPABASE_ANON_KEY=ваш-ключ
     SUPABASE_SERVICE_ROLE_KEY=ваш-service-ключ
     REPLICATE_API_TOKEN=ваш-токен
     ```
7. **Deploy!**

Получите URL: `https://carete-montage-production.up.railway.app`

**Стоимость:** 
- Бесплатно: $5 в месяц credits (достаточно для старта)
- Потом ~$5-10/месяц

---

## 2. Render.com 🎨

**Плюсы:** Бесплатный план, простой интерфейс

### Шаги:

1. **Перейдите на [render.com](https://render.com)**
2. **Sign up** через GitHub
3. **New** → **Web Service**
4. Подключите GitHub репозиторий `carete-montage`
5. **Настройки:**
   - **Name:** carete-montage
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
6. **Добавьте Environment Variables** (те же что выше)
7. **Create Web Service**

Получите URL: `https://carete-montage.onrender.com`

**Бесплатный план:**
- ⚠️ "Засыпает" после 15 мин неактивности
- Просыпается за ~30 секунд при первом запросе
- Подходит для тестирования

**Платный:** $7/месяц - без "засыпания"

---

## 3. Netlify 🌐

**Плюсы:** CDN, хороший бесплатный план

### Шаги:

1. **Перейдите на [netlify.com](https://netlify.com)**
2. **Sign up** через GitHub
3. **Add new site** → **Import an existing project**
4. Выберите `carete-montage`
5. **Build settings:**
   - Build command: `npm run build`
   - Publish directory: `.next`
6. **Install Next.js plugin:**
   ```bash
   npm install --save-dev @netlify/plugin-nextjs
   ```
7. **Добавьте Environment Variables**
8. **Deploy**

Получите URL: `https://carete-montage.netlify.app`

Файл `netlify.toml` уже создан!

---

## 4. Fly.io 🪰

**Плюсы:** Глобальный CDN, контейнеры

### Шаги:

1. **Установите Fly CLI:**
```bash
# macOS
brew install flyctl

# Или
curl -L https://fly.io/install.sh | sh
```

2. **Войдите:**
```bash
fly auth login
```

3. **Создайте приложение:**
```bash
fly launch
```

4. **Добавьте secrets:**
```bash
fly secrets set NEXT_PUBLIC_SUPABASE_URL="ваш-url"
fly secrets set NEXT_PUBLIC_SUPABASE_ANON_KEY="ваш-ключ"
fly secrets set SUPABASE_SERVICE_ROLE_KEY="ваш-service-ключ"
fly secrets set REPLICATE_API_TOKEN="ваш-токен"
```

5. **Deploy:**
```bash
fly deploy
```

Получите URL: `https://carete-montage.fly.dev`

**Бесплатный план:** Достаточно для небольшого трафика

---

## 5. Cloudflare Pages + Workers (Продвинутый)

**Плюсы:** Бесплатный, очень быстрый CDN

Требует настройки Next.js для edge runtime.

---

## 🎯 Моя рекомендация для России:

### **Railway.app** - Лучший выбор! ⭐

✅ Работает из России  
✅ Простой в настройке  
✅ Хороший бесплатный план ($5 credits)  
✅ Автоматический HTTPS  
✅ Поддержка Next.js из коробки  

### Инструкция для Railway:

```bash
# 1. Коммит изменений
git add .
git commit -m "Prepare for deployment"
git push origin main

# 2. Перейдите на railway.app
# 3. Sign up через GitHub
# 4. New Project → Deploy from GitHub
# 5. Выберите carete-montage
# 6. Добавьте environment variables
# 7. Deploy!
```

Через **5 минут** получите рабочий URL! 🚀

---

## 📧 После деплоя:

### Обновите email template:

1. Скопируйте ваш новый URL (например `https://carete-montage-production.up.railway.app`)

2. Откройте `email-templates/confirmation-email.html`

3. Замените все `YOUR_SITE_URL.vercel.app` на ваш URL:
```html
<img src="https://carete-montage-production.up.railway.app/icons/monty-logo.svg" />
<img src="https://carete-montage-production.up.railway.app/email-bg.png" />
<img src="https://carete-montage-production.up.railway.app/icons/monty-logo-small.svg" />
```

4. Скопируйте весь HTML

5. Вставьте в Supabase → **Authentication** → **Email Templates** → **Confirm signup**

---

## 🔧 Настройка Supabase после деплоя:

В Supabase Dashboard:

1. **Authentication** → **URL Configuration**
   - **Site URL:** `https://ваш-домен.railway.app`
   - **Redirect URLs:** добавьте `https://ваш-домен.railway.app/auth/callback`

2. **API Settings** → **Rate limits**
   - Увеличьте если нужно

---

## ⚡ Самый быстрый способ (прямо сейчас):

```bash
# 1. Установите Railway CLI
npm install -g @railway/cli

# 2. Войдите
railway login

# 3. Создайте проект и деплой
railway init
railway up

# 4. Добавьте переменные
railway variables set NEXT_PUBLIC_SUPABASE_URL=ваш-url
railway variables set NEXT_PUBLIC_SUPABASE_ANON_KEY=ваш-ключ
railway variables set SUPABASE_SERVICE_ROLE_KEY=ваш-service-ключ
railway variables set REPLICATE_API_TOKEN=ваш-токен

# 5. Получите URL
railway domain
```

**Готово за 5 минут!** 🎉

---

## 💡 Если все платформы недоступны:

### План B: Используйте email без изображений

Файл `email-templates/confirmation-email-inline.html` работает **БЕЗ** внешних картинок:
- Логотип = текст "monty"
- Hero = градиент с эмодзи
- Выглядит профессионально
- Работает везде

Просто скопируйте его в Supabase Email Template - и все! Никакого деплоя не нужно.

---

## 🆘 Помощь

Если возникли проблемы:
1. Railway обычно работает везде
2. Render - тоже хороший вариант
3. В крайнем случае - email без изображений (тоже красиво!)

