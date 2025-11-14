# ⚡ Простой способ запушить код

## Вариант 1: GitHub CLI (Самый простой) ⭐

```bash
# 1. Установите GitHub CLI
brew install gh

# 2. Войдите (откроется браузер - войдите новым аккаунтом)
gh auth login

# Выберите:
# → GitHub.com
# → HTTPS
# → Yes (authenticate Git)
# → Login with a web browser

# 3. Push
cd /Users/andrewaitken/carete-montage
git push -u origin main
```

**Готово!** ✅

---

## Вариант 2: Personal Access Token

### Прямая ссылка для создания токена:

Откройте эту ссылку (войдя в новый аккаунт AndrewAntoshkin):

**https://github.com/settings/tokens/new**

1. **Note:** montylist-deploy
2. **Expiration:** 90 days
3. **Scopes:** поставьте галочку на **repo** (все подпункты)
4. **Generate token**
5. **Скопируйте токен** (ghp_xxxxxx...)

### Затем:

```bash
cd /Users/andrewaitken/carete-montage

# Push с токеном (замените YOUR_TOKEN)
git push https://YOUR_TOKEN@github.com/AndrewAntoshkin/montylist.git main
```

---

## Вариант 3: Через веб-интерфейс GitHub

Если оба способа выше не работают:

### 1. Создайте архив проекта:

```bash
cd /Users/andrewaitken/carete-montage

# Удалите ненужные файлы
rm -rf node_modules .next

# Создайте zip
cd ..
zip -r montylist.zip carete-montage -x "*/node_modules/*" "*/.next/*" "*/.git/*"
```

### 2. Загрузите на GitHub:

1. Откройте https://github.com/AndrewAntoshkin/montylist
2. **Add file** → **Upload files**
3. Перетащите все файлы из папки `carete-montage`
4. **Commit changes**

---

## 🎯 РЕКОМЕНДУЮ: GitHub CLI (Вариант 1)

**Это самый простой способ!**

Одна команда решит проблему:
```bash
brew install gh && gh auth login
```

После этого `git push` всегда будет работать! 🚀

---

## Готовы?

Скажите какой вариант выбрали, помогу с командами! 😊

