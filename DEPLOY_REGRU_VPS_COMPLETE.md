# 🚀 Полный гайд: Деплой Монтажного листа на VPS REG.RU

## 📊 Сравнение вариантов

### Вариант 1: VPS от REG.RU
| Показатель | VPS Cloud-2 | Railway | Vercel |
|------------|-------------|---------|--------|
| Цена | ~499₽/мес | ~$5/мес (~500₽) | Бесплатно* |
| Локация | Россия 🇷🇺 | США/ЕС | США/ЕС |
| FFmpeg | ✅ Нативный | ✅ Docker | ⚠️ Только WASM |
| Serverless | ❌ Постоянный | ❌ Постоянный | ✅ Serverless |
| Таймаут запроса | ∞ | 30 мин | 60 сек |
| Контроль | Полный | Средний | Минимальный |
| Настройка | Ручная | Автоматическая | Автоматическая |

> *Vercel имеет лимиты на бесплатном плане и ограничения для серверлесс функций

### 🎯 Рекомендация

**Для вашего приложения (обработка видео) лучше всего:**

1. **VPS REG.RU Cloud-2** (499₽/мес) — если хотите всё в России
2. **Railway** (~500₽/мес) — если нужен простой деплой без настройки сервера

---

## 🖥️ Вариант 1: Деплой на VPS REG.RU

### Шаг 1: Заказ VPS

1. Зайдите на [reg.ru/vps](https://www.reg.ru/vps/)
2. Выберите тариф **Cloud-2** или выше:
   - RAM: минимум 2 GB (рекомендую 4 GB)
   - CPU: 1+ ядро
   - SSD: 30+ GB
   - ОС: **Ubuntu 22.04 LTS**

3. Оплатите и получите:
   - IP адрес
   - root пароль
   - SSH доступ

### Шаг 2: Первоначальная настройка сервера

```bash
# Подключитесь к серверу
ssh root@ВАШ_IP_АДРЕС

# Обновите систему
apt update && apt upgrade -y

# Создайте пользователя для приложения (безопаснее чем root)
adduser monty
usermod -aG sudo monty

# Настройте SSH ключи (опционально, но рекомендуется)
mkdir -p /home/monty/.ssh
cp ~/.ssh/authorized_keys /home/monty/.ssh/
chown -R monty:monty /home/monty/.ssh
```

### Шаг 3: Установка необходимого ПО

```bash
# Установите Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Установите FFmpeg
apt install -y ffmpeg

# Установите PM2 глобально
npm install -g pm2

# Установите Nginx
apt install -y nginx

# Установите Git
apt install -y git

# Проверьте установку
node --version  # v20.x
npm --version
ffmpeg -version
pm2 --version
```

### Шаг 4: Настройте Nginx

```bash
nano /etc/nginx/sites-available/montylist
```

Вставьте:

```nginx
server {
    listen 80;
    server_name montylist.ru www.montylist.ru;

    # Увеличенные лимиты для загрузки видео
    client_max_body_size 500M;
    client_body_timeout 300s;
    
    # Буферизация для больших файлов
    client_body_buffer_size 128k;
    proxy_buffering off;

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
        
        # Увеличенные таймауты для обработки видео
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
    }
    
    # Статические файлы Next.js
    location /_next/static {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Активируйте:

```bash
ln -s /etc/nginx/sites-available/montylist /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # Удалите default
nginx -t
systemctl restart nginx
systemctl enable nginx
```

### Шаг 5: Настройте SSL (HTTPS)

```bash
# Установите Certbot
apt install -y certbot python3-certbot-nginx

# Получите сертификат (после настройки DNS!)
certbot --nginx -d montylist.ru -d www.montylist.ru

# Автообновление сертификата (уже настроено по умолчанию)
certbot renew --dry-run
```

### Шаг 6: Клонируйте и настройте проект

```bash
# Переключитесь на пользователя monty
su - monty

# Клонируйте репозиторий
cd ~
git clone https://github.com/ВАШ_USERNAME/carete-montage.git
cd carete-montage

# Создайте .env.local
nano .env.local
```

Содержимое `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://goykmdyodqhptkzfgumq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ваш-anon-key
SUPABASE_SERVICE_ROLE_KEY=ваш-service-role-key

# AI APIs
REPLICATE_API_TOKEN=ваш-replicate-token
GOOGLE_AI_API_KEY=ваш-gemini-key

# Продакшен настройки
NODE_ENV=production
```

### Шаг 7: Соберите и запустите

```bash
# Установите зависимости
npm ci

# Соберите проект
npm run build

# Запустите через PM2
pm2 start npm --name "montylist" -- start

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Проверьте статус
pm2 status
pm2 logs montylist
```

### Шаг 8: Настройте DNS в REG.RU

В личном кабинете REG.RU → Домены → montylist.ru → DNS:

```
Тип: A      Имя: @     Значение: ВАШ_IP_АДРЕС
Тип: A      Имя: www   Значение: ВАШ_IP_АДРЕС
```

---

## 🔄 Автоматический деплой с GitHub Actions

Создайте файл `.github/workflows/deploy.yml`:

```yaml
name: Deploy to REG.RU VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: monty
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/carete-montage
            git pull origin main
            npm ci
            npm run build
            pm2 restart montylist
```

### Настройка GitHub Secrets

В репозитории → Settings → Secrets → Actions:

1. **VPS_HOST** — IP адрес вашего VPS
2. **VPS_SSH_KEY** — приватный SSH ключ

Генерация SSH ключа:

```bash
# На вашем компьютере
ssh-keygen -t ed25519 -C "github-deploy"

# Скопируйте публичный ключ на сервер
ssh-copy-id -i ~/.ssh/id_ed25519.pub monty@ВАШ_IP

# Приватный ключ (~/.ssh/id_ed25519) добавьте в GitHub Secrets
```

---

## 🛡️ Безопасность

### Firewall (UFW)

```bash
# Включите firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

### Fail2ban (защита от брутфорса)

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### Автообновления безопасности

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 📈 Мониторинг

### PM2 мониторинг

```bash
# Статус приложения
pm2 status

# Логи в реальном времени
pm2 logs montylist

# Мониторинг ресурсов
pm2 monit

# Веб-мониторинг (опционально)
pm2 plus
```

### Системный мониторинг

```bash
# Использование диска
df -h

# Использование памяти
free -h

# Нагрузка CPU
htop
```

---

## 🔧 Полезные команды

### Управление приложением

```bash
pm2 restart montylist    # Перезапуск
pm2 stop montylist       # Остановка
pm2 start montylist      # Запуск
pm2 delete montylist     # Удаление
pm2 logs montylist --lines 100  # Последние 100 строк логов
```

### Обновление приложения вручную

```bash
cd ~/carete-montage
git pull
npm ci
npm run build
pm2 restart montylist
```

### Просмотр логов Nginx

```bash
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## 💰 Итоговая стоимость

| Услуга | Цена |
|--------|------|
| VPS Cloud-2 REG.RU | ~499₽/мес |
| Домен montylist.ru | уже оплачен |
| SSL сертификат | бесплатно (Let's Encrypt) |
| **Итого** | **~499₽/мес** |

---

## ✅ Чеклист

- [ ] Заказан VPS на REG.RU (Cloud-2 или выше)
- [ ] Установлен Node.js 20
- [ ] Установлен FFmpeg
- [ ] Установлен PM2
- [ ] Настроен Nginx
- [ ] Настроен SSL (Certbot)
- [ ] Клонирован репозиторий
- [ ] Создан .env.local с ключами
- [ ] Приложение собрано (npm run build)
- [ ] Приложение запущено через PM2
- [ ] Настроен автозапуск (pm2 startup)
- [ ] DNS записи настроены в REG.RU
- [ ] Настроен GitHub Actions для автодеплоя
- [ ] Включен UFW firewall
- [ ] Установлен fail2ban

---

## 🆘 Troubleshooting

### Приложение не запускается

```bash
# Проверьте логи
pm2 logs montylist --lines 50

# Проверьте .env.local
cat ~/carete-montage/.env.local

# Проверьте порт
netstat -tlnp | grep 3000
```

### 502 Bad Gateway

```bash
# Проверьте что приложение работает
pm2 status

# Если нет — перезапустите
pm2 restart montylist

# Проверьте Nginx
nginx -t
systemctl restart nginx
```

### Не хватает памяти

```bash
# Добавьте swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Долгая обработка видео

На VPS можно обрабатывать видео без таймаутов — это преимущество перед serverless!

---

## 🎯 Вывод

### VPS REG.RU подходит если:
- ✅ Хотите сервер в России (быстрее для РФ пользователей)
- ✅ Нужен нативный FFmpeg без ограничений
- ✅ Хотите полный контроль над сервером
- ✅ Готовы к начальной настройке (~1-2 часа)

### VPS REG.RU НЕ подходит если:
- ❌ Не хотите заниматься администрированием
- ❌ Нужен автоскейлинг при нагрузке
- ❌ Предпочитаете платить только за использование

### Альтернатива: Railway
Если не хотите настраивать сервер вручную — используйте Railway:
- Автодеплой из GitHub
- Не нужно настраивать nginx/ssl
- Похожая цена (~$5/мес)
- Но сервера в США/ЕС

---

## 📞 Нужна помощь?

Если что-то не получается — напишите мне! 🚀
