# ✅ Решение: Supabase Storage для Email (БЕЗ деплоя!)

## 🎯 Изображения для email уже загружены в Supabase!

**Результат выполнения скрипта:**

✅ **Logo:** https://goykmdyodqhptkzfgumq.supabase.co/storage/v1/object/public/email-assets/monty-logo.svg

✅ **Small Logo:** https://goykmdyodqhptkzfgumq.supabase.co/storage/v1/object/public/email-assets/monty-logo-small.svg

✅ **Background:** https://goykmdyodqhptkzfgumq.supabase.co/storage/v1/object/public/email-assets/email-bg.png

---

## 📧 Настройка Email Template (2 минуты)

### Шаг 1: Скопируйте готовый HTML

Откройте файл: `email-templates/confirmation-email-supabase.html`

Или просто скопируйте из терминала:
```bash
cat email-templates/confirmation-email-supabase.html
```

### Шаг 2: Вставьте в Supabase

1. Откройте **Supabase Dashboard**
2. **Authentication** → **Email Templates**
3. Выберите **Confirm signup**
4. **Subject:** 
   ```
   Подтвердите регистрацию в Monty
   ```
5. **Message Body (HTML):** Вставьте весь HTML из файла
6. **Save**

### ✅ Готово! Email работает БЕЗ деплоя приложения!

Изображения грузятся прямо из Supabase Storage - никакого внешнего хостинга не нужно!

---

## 🚀 Для самого приложения все равно нужен хостинг

**Важно:** Supabase - это только база данных, аутентификация и storage. Для Next.js приложения нужна платформа хостинга.

### Минимальный вариант: Railway (бесплатный старт)

**Почему Railway:**
- ✅ $5 trial credits (хватит на месяц тестирования)
- ✅ Работает из России
- ✅ Простая настройка
- ✅ Автоматический деплой
- ✅ Бесплатный SSL

**После trial:** ~$5/месяц (очень дешево!)

### Быстрый старт:

```bash
# 1. Коммит кода
git add .
git commit -m "Ready for production"
git push origin main

# 2. Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up

# 3. Добавьте переменные
railway variables set NEXT_PUBLIC_SUPABASE_URL="$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d '=' -f2)"
railway variables set NEXT_PUBLIC_SUPABASE_ANON_KEY="$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d '=' -f2)"
railway variables set SUPABASE_SERVICE_ROLE_KEY="$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d '=' -f2)"
railway variables set REPLICATE_API_TOKEN="$(grep REPLICATE_API_TOKEN .env.local | cut -d '=' -f2)"

# 4. Получите URL
railway domain
```

### Подключите montylist.ru:

В Railway:
1. **Settings** → **Domains** → **Custom Domain**
2. Введите `montylist.ru`
3. Следуйте инструкциям для reg.ru DNS

---

## 💡 Альтернатива без хостинга (только тестирование):

Для тестирования email можете запустить локально:

```bash
# Запустите dev server
npm run dev

# В другом терминале - сделайте туннель
npx localtunnel --port 3000 --subdomain montylist

# Получите публичный URL
# Используйте его для тестирования email
```

⚠️ **Не подходит для продакшена** - только для проверки дизайна email!

---

## 🎯 Итоговое решение:

### Что уже работает:
✅ **Email изображения** - в Supabase Storage (бесплатно!)
✅ **Email template** - готов (`confirmation-email-supabase.html`)

### Что нужно для запуска приложения:
🔧 **Хостинг Next.js** - Railway ($5/мес после trial)

### Общая стоимость:
- **Домен montylist.ru:** ~300₽/год
- **Supabase:** уже оплачен ✅
- **Railway:** $5 trial → потом $5-10/мес
- **Replicate:** pay-as-you-go (~$0.10 за видео)

**Итого:** ~$5-10/месяц = ~500-1000₽/месяц

---

## 📋 Чек-лист:

- [x] Изображения загружены в Supabase Storage
- [x] Email template готов (confirmation-email-supabase.html)
- [ ] Настроить email template в Supabase (2 мин)
- [ ] Задеплоить на Railway (5 мин)
- [ ] Подключить montylist.ru (5 мин)
- [ ] Протестировать регистрацию

---

## ⚡ Следующий шаг:

**Настройте email template прямо сейчас** (работает без деплоя):

1. Откройте Supabase Dashboard
2. Authentication → Email Templates → Confirm signup
3. Скопируйте `email-templates/confirmation-email-supabase.html`
4. Вставьте в Supabase
5. Save

**Готово!** Email с красивыми картинками будет работать сразу! 🎨

Для запуска самого приложения - следуйте `QUICK_DEPLOY.md` 🚀

