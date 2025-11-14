# 🔄 Перенос проекта на новый GitHub аккаунт

## 📋 План действий (5 минут):

---

### Шаг 1: Создайте новый репозиторий на новом GitHub

1. Войдите в **новый GitHub аккаунт**
2. Нажмите **"+"** → **"New repository"**
3. **Repository name:** `carete-montage` (или `montylist`)
4. **Description:** `AI-powered montage sheets generator`
5. **Visibility:** Private (или Public)
6. **НЕ добавляйте:** README, .gitignore, license (уже есть в проекте)
7. **Create repository**

GitHub покажет URL репозитория, например:
```
https://github.com/ваш-новый-username/carete-montage.git
```

Скопируйте этот URL!

---

### Шаг 2: Измените remote origin в локальном проекте

```bash
# Перейдите в папку проекта
cd /Users/andrewaitken/carete-montage

# Посмотрите текущий remote
git remote -v

# Удалите старый remote
git remote remove origin

# Добавьте новый remote (вставьте ваш URL)
git remote add origin https://github.com/ваш-новый-username/carete-montage.git

# Проверьте
git remote -v
```

---

### Шаг 3: Закоммитьте все изменения

```bash
# Проверьте статус
git status

# Добавьте все файлы
git add .

# Коммит
git commit -m "Initial commit: Production ready for montylist.ru"

# Пуш в новый репозиторий
git push -u origin main
```

Если будет ошибка про ветку `main` vs `master`:
```bash
# Переименуйте ветку в main если нужно
git branch -M main
git push -u origin main
```

---

### Шаг 4: Проверьте на GitHub

Откройте новый репозиторий на GitHub - код должен появиться!

---

### Шаг 5: Деплой на Vercel

Теперь, когда у вас **новый GitHub аккаунт** и Vercel работает:

#### Через веб-интерфейс (проще):

1. Откройте [vercel.com](https://vercel.com)
2. **Вы уже залогинены** с новым GitHub
3. **Add New...** → **Project**
4. **Import Git Repository** → найдите `carete-montage`
5. **Import**
6. Vercel автоматически определит Next.js
7. **Environment Variables** → добавьте:
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   REPLICATE_API_TOKEN
   ```
8. **Deploy**

**Готово через 2-3 минуты!** ⚡

#### Или через CLI:

```bash
# Установите Vercel CLI (если еще нет)
npm install -g vercel

# Войдите (используйте новый аккаунт)
vercel login

# Деплой
vercel

# Добавьте env variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add REPLICATE_API_TOKEN

# Production деплой
vercel --prod
```

---

### Шаг 6: Подключите домен montylist.ru

**В Vercel:**
1. Проект → **Settings** → **Domains**
2. **Add** → введите `montylist.ru`
3. Vercel покажет DNS инструкции

**В reg.ru:**
1. Домены → montylist.ru → **Управление DNS**
2. Добавьте записи от Vercel (обычно A или CNAME)

---

### Шаг 7: Обновите Supabase URLs

**Supabase Dashboard → Authentication → URL Configuration:**

- **Site URL:** `https://montylist.ru`
- **Redirect URLs:** `https://montylist.ru/auth/callback`

---

## ✅ Готово!

Теперь проект на новом GitHub аккаунте и задеплоен на Vercel!

---

## 🔧 Дополнительно: Настройка локальной работы

После переноса на новый GitHub, при следующей работе:

```bash
# Все команды работают как обычно
git add .
git commit -m "Some changes"
git push origin main

# Vercel автоматически задеплоит!
```

---

## 🎯 Преимущества Vercel:

- ✅ **БЕСПЛАТНО** для личных проектов (навсегда!)
- ✅ Безлимитный трафик
- ✅ Автоматический HTTPS
- ✅ Автодеплой при каждом push
- ✅ Preview deployments для каждого PR
- ✅ Edge Network (очень быстро)
- ✅ Отличная интеграция с Next.js

**Проблема с таймаутом:**
- Free plan: 10 секунд timeout
- Для длинных видео может быть мало

**Решение:**
- Обработка видео уже асинхронная (не блокирует запрос)
- Должно работать!

---

## 📝 Чеклист переноса:

- [ ] Создать новый репозиторий на новом GitHub
- [ ] Изменить remote origin
- [ ] git push -u origin main
- [ ] Проверить код на новом GitHub
- [ ] Import в Vercel
- [ ] Добавить env variables
- [ ] Deploy
- [ ] Подключить montylist.ru
- [ ] Обновить Supabase URLs
- [ ] Протестировать!

---

## ⚡ Быстрые команды:

```bash
# В папке проекта
cd /Users/andrewaitken/carete-montage

# Измените remote
git remote remove origin
git remote add origin https://github.com/новый-username/carete-montage.git

# Коммит и пуш
git add .
git commit -m "Initial commit on new GitHub account"
git push -u origin main
```

Потом сразу в Vercel → Import → Deploy! 🚀

---

## 🎊 Итог:

**Да, можем легко перенести!** 

1. Новый репозиторий на новом GitHub (2 мин)
2. Изменить remote origin (1 мин)
3. git push (1 мин)
4. Vercel deploy (2 мин)

**Итого: 6 минут!** ⚡

Готовы начать? Создавайте репозиторий на новом GitHub! 😊

