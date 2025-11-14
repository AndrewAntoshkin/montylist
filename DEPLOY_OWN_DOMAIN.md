# 🌐 Деплой на свой домен/хостинг

Если у вас уже есть домен и VPS/хостинг:

---

## Вариант 1: VPS (Ubuntu/Debian) + PM2 + Nginx

### Требования:
- VPS с Ubuntu/Debian
- SSH доступ
- Домен (например: `monty.yoursite.com`)

### Шаг 1: Подготовьте VPS

```bash
# SSH на сервер
ssh root@your-server-ip

# Обновите систему
apt update && apt upgrade -y

# Установите Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Установите PM2 и Nginx
npm install -g pm2
apt install -y nginx

# Установите FFmpeg (для обработки видео)
apt install -y ffmpeg
```

### Шаг 2: Загрузите код

```bash
# Установите git
apt install -y git

# Клонируйте репозиторий
cd /var/www
git clone https://github.com/ваш-username/carete-montage.git
cd carete-montage

# Установите зависимости
npm install

# Создайте .env.local
nano .env.local
```

Добавьте в `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=ваш-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=ваш-ключ
SUPABASE_SERVICE_ROLE_KEY=ваш-service-ключ
REPLICATE_API_TOKEN=ваш-токен
```

### Шаг 3: Соберите и запустите

```bash
# Соберите продакшн версию
npm run build

# Запустите через PM2
pm2 start npm --name "monty" -- start

# Автозапуск при перезагрузке
pm2 startup
pm2 save
```

### Шаг 4: Настройте Nginx

```bash
# Создайте конфиг Nginx
nano /etc/nginx/sites-available/monty
```

Вставьте:
```nginx
server {
    listen 80;
    server_name monty.yoursite.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Увеличиваем таймауты для обработки видео
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }
    
    # Увеличиваем максимальный размер тела запроса для загрузки видео
    client_max_body_size 100M;
}
```

Активируйте:
```bash
ln -s /etc/nginx/sites-available/monty /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Шаг 5: Настройте HTTPS (Let's Encrypt)

```bash
# Установите Certbot
apt install -y certbot python3-certbot-nginx

# Получите SSL сертификат
certbot --nginx -d monty.yoursite.com

# Автообновление сертификата
certbot renew --dry-run
```

### Шаг 6: Настройте DNS

В вашем DNS провайдере (Cloudflare, GoDaddy и т.д.):

```
Тип: A
Имя: monty (или @)
Значение: IP вашего VPS
TTL: 3600
```

✅ **Готово!** Приложение доступно на `https://monty.yoursite.com`

---

## Вариант 2: Railway (Без VPS) ⚡

**Самый простой вариант!**

### Шаги:

1. Перейдите на **[railway.app](https://railway.app)**
2. **Login with GitHub**
3. **New Project** → **Deploy from GitHub repo**
4. Выберите `carete-montage`
5. Railway автоматически:
   - ✅ Определит Next.js
   - ✅ Запустит build
   - ✅ Выдаст URL
6. **Добавьте переменные:**
   - Кликните на проект
   - Вкладка **Variables**
   - Добавьте все ENV переменные
7. **Подключите свой домен:**
   - **Settings** → **Domains**
   - **Custom Domain** → `monty.yoursite.com`
   - Railway покажет DNS записи
   - Добавьте их в ваш DNS

✅ **Готово!** SSL сертификат создастся автоматически

**Стоимость:**
- Trial: $5 credits (хватит на ~1 месяц тестирования)
- Потом: ~$5-10/месяц

---

## Вариант 3: Render + свой домен

### Шаги:

1. **Deploy на Render** (см. выше)
2. **Добавьте домен:**
   - В Render → **Settings** → **Custom Domain**
   - Введите `monty.yoursite.com`
   - Render покажет CNAME запись
3. **Обновите DNS:**
```
Тип: CNAME
Имя: monty
Значение: carete-montage.onrender.com
```

✅ **Готово!** SSL автоматический

---

## Вариант 4: Netlify + свой домен

1. **Deploy на Netlify**
2. **Domain settings** → **Add custom domain**
3. Следуйте инструкциям по настройке DNS

---

## 📧 После деплоя на ЛЮБУЮ платформу:

### 1. Получите ваш URL
Например: `https://monty.yoursite.com`

### 2. Обновите email template

В `email-templates/confirmation-email.html` замените:
```html
<!-- Было -->
<img src="https://YOUR_SITE_URL.vercel.app/icons/monty-logo.svg" />

<!-- Стало -->
<img src="https://monty.yoursite.com/icons/monty-logo.svg" />
```

### 3. Вставьте в Supabase

**Supabase Dashboard** → **Authentication** → **Email Templates** → **Confirm signup**

### 4. Обновите Supabase URLs

**Authentication** → **URL Configuration**:
- **Site URL:** `https://monty.yoursite.com`
- **Redirect URLs:** `https://monty.yoursite.com/auth/callback`

---

## ⚡ Самый быстрый способ (прямо сейчас):

### Railway через CLI:

```bash
# 1. Установите Railway CLI
npm install -g @railway/cli

# 2. Войдите
railway login

# 3. Инициализируйте проект
cd /Users/andrewaitken/carete-montage
railway init

# 4. Добавьте переменные
railway variables set NEXT_PUBLIC_SUPABASE_URL="ваш-url"
railway variables set NEXT_PUBLIC_SUPABASE_ANON_KEY="ваш-ключ"
railway variables set SUPABASE_SERVICE_ROLE_KEY="ваш-service-ключ"
railway variables set REPLICATE_API_TOKEN="ваш-токен"

# 5. Deploy
railway up

# 6. Получите URL
railway domain
```

**Время:** ~3 минуты ⚡

---

## 🆘 Если ничего не работает:

### Используйте Supabase Storage для изображений

```bash
# Загрузите изображения
npm run upload-email-assets
```

Скрипт:
1. Создаст публичный bucket в Supabase
2. Загрузит все изображения
3. Выдаст публичные URL
4. Вы вставите их в email template

**Не требует деплоя приложения!** Изображения живут в Supabase.

---

## 🎯 Итоговая рекомендация:

1. **Попробуйте Railway** - обычно работает везде
2. Если не получится - **Render**
3. Если и это не работает - **Supabase Storage для изображений**

Все 3 варианта бесплатны для старта! 🚀

