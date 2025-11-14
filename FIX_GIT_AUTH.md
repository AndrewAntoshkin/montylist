# 🔐 Исправление Git Authentication

## Проблема:

Git использует старые credentials от аккаунта `AndrewAitken`, а нужен новый `AndrewAntoshkin`.

---

## ✅ Решение (выберите один способ):

### Способ 1: Personal Access Token (Рекомендую) ⭐

#### 1. Создайте Personal Access Token на новом GitHub:

1. Войдите в **новый аккаунт** AndrewAntoshkin на GitHub
2. Settings → Developer settings → Personal access tokens → **Tokens (classic)**
3. **Generate new token** → **Generate new token (classic)**
4. **Note:** `montylist-deployment`
5. **Expiration:** 90 days (или No expiration)
6. **Select scopes:**
   - ✅ `repo` (все подпункты)
   - ✅ `workflow`
7. **Generate token**
8. **СКОПИРУЙТЕ ТОКЕН** (он больше не покажется!)

Например: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

#### 2. Используйте токен для push:

```bash
cd /Users/andrewaitken/carete-montage

# Измените URL на формат с токеном
git remote set-url origin https://ваш-токен@github.com/AndrewAntoshkin/montylist.git

# Или вручную при push
git push https://ваш-токен@github.com/AndrewAntoshkin/montylist.git main
```

---

### Способ 2: SSH ключи (Более безопасно)

#### 1. Создайте SSH ключ:

```bash
# Сгенерируйте новый SSH ключ
ssh-keygen -t ed25519 -C "ваш-email@example.com"

# Нажмите Enter 3 раза (default путь, без пароля)

# Скопируйте публичный ключ
cat ~/.ssh/id_ed25519.pub
```

#### 2. Добавьте SSH ключ на GitHub:

1. Войдите в новый аккаунт AndrewAntoshkin
2. Settings → SSH and GPG keys → **New SSH key**
3. **Title:** `Mac - montylist`
4. **Key:** Вставьте скопированный ключ
5. **Add SSH key**

#### 3. Измените remote на SSH:

```bash
cd /Users/andrewaitken/carete-montage

# Измените URL на SSH
git remote set-url origin git@github.com:AndrewAntoshkin/montylist.git

# Проверьте
git remote -v
```

---

### Способ 3: GitHub CLI (Самый простой)

```bash
# Установите GitHub CLI
brew install gh

# Войдите в новый аккаунт
gh auth login

# Выберите:
# - GitHub.com
# - HTTPS
# - Login with a web browser

# Следуйте инструкциям в браузере (войдите новым аккаунтом)

# Теперь push сработает
git push -u origin main
```

---

## ⚡ Быстрое решение (прямо сейчас):

### Используйте Personal Access Token:

```bash
# 1. Создайте токен на GitHub (см. выше)

# 2. Push с токеном
cd /Users/andrewaitken/carete-montage
git push https://ваш-токен@github.com/AndrewAntoshkin/montylist.git main
```

**Готово!** Код появится в новом репозитории.

---

## 🎯 После успешного push:

### Проверьте на GitHub:
Откройте https://github.com/AndrewAntoshkin/montylist

Должен быть весь код! ✅

### Сразу деплойте на Vercel:

1. [vercel.com](https://vercel.com) (вы уже залогинены новым аккаунтом)
2. **Add New...** → **Project**
3. **Import** → найдите `AndrewAntoshkin/montylist`
4. **Deploy!**

---

## 📝 Рекомендация:

**Используйте Способ 1 (Personal Access Token)** для быстрого решения прямо сейчас.

После деплоя можете настроить SSH (Способ 2) для постоянной работы.

---

## 🆘 Если токен не работает:

**Альтернатива:** Скачайте код и загрузите через веб:

```bash
# Создайте архив
cd /Users/andrewaitken/carete-montage
git archive --format=zip --output=../montylist.zip HEAD

# Или просто zip всей папки (без node_modules)
cd ..
zip -r montylist.zip carete-montage -x "*/node_modules/*" "*.next/*"
```

Потом на GitHub:
1. Repository → **Add file** → **Upload files**
2. Загрузите архив
3. Commit!

Но **токен проще!** 😊

