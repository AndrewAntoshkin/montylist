# 🎬 FFmpeg Setup для разработки

## Проблема

Next.js не может правильно разрешить динамические импорты от `@ffmpeg-installer/ffmpeg` в dev mode.

**Ошибка:**
```
Module not found: Can't resolve './ROOT/carete-montage/node_modules/@ffmpeg-installer/darwin-arm64/package.json'
```

---

## ✅ Решение: Установить системный FFmpeg

### macOS

#### Через Homebrew (рекомендуется):

```bash
# 1. Установить Homebrew (если еще не установлен)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Установить FFmpeg
brew install ffmpeg

# 3. Проверить установку
ffmpeg -version
```

#### Или скачать бинарник:

1. Скачать FFmpeg: https://evermeet.cx/ffmpeg/
2. Распаковать и переместить в `/usr/local/bin/`
3. Дать права на выполнение: `chmod +x /usr/local/bin/ffmpeg`

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install ffmpeg

# Проверить
ffmpeg -version
```

### Linux (CentOS/RHEL)

```bash
sudo yum install epel-release
sudo yum install ffmpeg

# Проверить
ffmpeg -version
```

### Windows

1. Скачать FFmpeg: https://www.gyan.dev/ffmpeg/builds/
2. Распаковать в `C:\ffmpeg`
3. Добавить `C:\ffmpeg\bin` в PATH
4. Перезапустить терминал
5. Проверить: `ffmpeg -version`

---

## 🔧 Как это работает

### В коде (lib/video-splitter.ts):

```typescript
try {
  // Пытаемся использовать @ffmpeg-installer/ffmpeg
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  console.log('✅ Using installed FFmpeg');
} catch (error) {
  // Fallback на системный FFmpeg
  console.log('⚠️  Using system FFmpeg (ffmpeg command must be in PATH)');
  // fluent-ffmpeg автоматически использует команду 'ffmpeg' из PATH
}
```

### В Next.js config:

```typescript
serverComponentsExternalPackages: ['fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],
webpack: (config, { isServer }) => {
  if (isServer) {
    config.externals.push({
      'fluent-ffmpeg': 'commonjs fluent-ffmpeg',
      '@ffmpeg-installer/ffmpeg': 'commonjs @ffmpeg-installer/ffmpeg',
    });
  }
  return config;
}
```

---

## ✅ Проверка установки

```bash
# Проверить что FFmpeg установлен и доступен
which ffmpeg

# Должно вывести путь, например:
# /usr/local/bin/ffmpeg
# или
# /opt/homebrew/bin/ffmpeg

# Проверить версию
ffmpeg -version

# Должно показать что-то вроде:
# ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers
# ...
```

---

## 🚀 После установки

1. **Перезапустить Next.js dev server:**
   ```bash
   # Остановить текущий процесс (Ctrl+C)
   # Запустить снова
   npm run dev
   ```

2. **Проверить логи:**
   При загрузке длинного видео должно появиться:
   ```
   ✅ Using system FFmpeg: /usr/local/bin/ffmpeg
   📥 Downloading original video...
   ✂️  Splitting video into 3 chunks...
   ```

---

## 🐛 Troubleshooting

### Ошибка: "ffmpeg: command not found"

**Проблема:** FFmpeg не установлен или не в PATH

**Решение:**
1. Установить FFmpeg (см. инструкции выше)
2. Убедиться что `which ffmpeg` возвращает путь
3. Перезапустить терминал и Next.js dev server

### Ошибка: "Permission denied"

**Проблема:** Нет прав на выполнение FFmpeg

**Решение:**
```bash
chmod +x /usr/local/bin/ffmpeg
# или
chmod +x /opt/homebrew/bin/ffmpeg
```

### Ошибка: "Module not found: @ffmpeg-installer..."

**Проблема:** Next.js не может разрешить импорт (в dev mode)

**Решение:**
1. Убедитесь что системный FFmpeg установлен
2. Код автоматически упадет на fallback
3. Проверьте логи - должно быть "⚠️  Using system FFmpeg"

### FFmpeg работает, но очень медленно

**Проблема:** Возможно используется не оптимизированная версия

**Решение:**
```bash
# На macOS переустановить через Homebrew
brew reinstall ffmpeg

# На Linux обновить
sudo apt upgrade ffmpeg
```

---

## 📦 Production deployment

### Vercel

Vercel автоматически устанавливает FFmpeg в runtime environment. Код будет работать без изменений.

### Docker

Добавить в Dockerfile:

```dockerfile
FROM node:18-alpine

# Установить FFmpeg
RUN apk add --no-cache ffmpeg

# ... остальные команды
```

### VPS/Dedicated Server

Установить FFmpeg на сервере:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# CentOS
sudo yum install ffmpeg
```

---

## 💡 Альтернативы

Если не хочется устанавливать системный FFmpeg, есть альтернативы:

### 1. ffmpeg.wasm (WebAssembly)

Работает в браузере, но медленнее:
```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util
```

### 2. Использовать внешний сервис

Отправлять видео на внешний сервис для нарезки (AWS MediaConvert, Cloudinary, etc.)

### 3. Статический бинарник

Скачать статический бинарник FFmpeg и положить в проект:
```
/bin/
  ffmpeg-macos
  ffmpeg-linux
  ffmpeg-windows.exe
```

---

## ✅ Рекомендации

**Для локальной разработки:**
- Установить системный FFmpeg через Homebrew/apt
- Самое простое и быстрое решение

**Для production:**
- На Vercel: работает из коробки
- На Docker: добавить FFmpeg в образ
- На VPS: установить системный FFmpeg

---

**После установки FFmpeg все должно работать! 🎬✨**




