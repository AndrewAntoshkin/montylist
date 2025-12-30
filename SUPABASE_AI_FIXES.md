# ✅ ИСПРАВЛЕНИЯ ПО РЕКОМЕНДАЦИЯМ SUPABASE AI

## 🎯 КЛЮЧЕВАЯ ПРОБЛЕМА (найдена Supabase AI):

**При retry мы использовали СТАРЫЙ signed URL!**

```
Попытка 1: uploadUrl_v1 → частично загрузил → 502
Попытка 2: uploadUrl_v1 → тот же URL → 502 (URL уже использован!)
Попытка 3: uploadUrl_v1 → тот же URL → 502
```

**Signed URLs одноразовые!** После частичного использования retry с тем же URL не работает.

---

## ✅ ЧТО ИСПРАВЛЕНО:

### 1. **`app/api/create-upload-url/route.ts`**

Добавили параметры согласно best practices:

```diff
const { data, error } = await supabase.storage
  .from('videos')
  .createSignedUploadUrl(storagePath, {
    expiresIn: 1800,
+   upsert: false, // явно указываем
  });
```

### 2. **`components/UploadModalLong.tsx`** - ГЛАВНОЕ ИСПРАВЛЕНИЕ

**Было (НЕПРАВИЛЬНО):**
```typescript
// Получаем URL ОДИН РАЗ
const { uploadUrl } = await fetch('/api/create-upload-url');

// Retry с ТЕМ ЖЕ URL
for (let attempt = 1; attempt <= 3; attempt++) {
  await fetch(uploadUrl, { method: 'PUT' }); // ❌ Плохо!
}
```

**Стало (ПРАВИЛЬНО):**
```typescript
const uploadWithRetry = async (maxAttempts = 3) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Получаем НОВЫЙ URL для КАЖДОЙ попытки
      const { uploadUrl, storagePath } = await fetch('/api/create-upload-url', {
        body: JSON.stringify({ filename, fileType, fileSize })
      });
      
      // Пробуем загрузить
      await fetch(uploadUrl, { method: 'PUT', body: file });
      
      // Успех - возвращаем storagePath
      return storagePath;
      
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      // Exponential backoff перед новым URL
      await delay(3s, 6s, 12s);
    }
  }
};
```

**Ключевые изменения:**
- ✅ **НОВЫЙ signed URL** для каждой retry попытки
- ✅ Логирование response headers для диагностики
- ✅ Exponential backoff (3s → 6s → 12s)
- ✅ Возвращаем `storagePath` из успешной попытки

---

## 📊 ДРУГИЕ РЕКОМЕНДАЦИИ SUPABASE (уже выполнены):

### ✅ Не используем `keepalive: true`
Chrome ограничивает keepalive до 64 KB - не подходит для больших файлов.

### ✅ Не указываем `Content-Length` вручную
Браузер вычисляет автоматически из File object.

### ✅ Используем правильный `Content-Type`
Точно совпадает между signed URL и PUT request.

### ✅ Уменьшили chunk size
10 минут (~75 MB) вместо 20 минут (~153 MB).

---

## 🧪 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ:

### При первой попытке (если Supabase стабилен):
```
📝 Attempt 1/3: Requesting NEW upload URL...
✅ Got upload URL for attempt 1
📤 Uploading file to storage (attempt 1)...
Progress: 10% → 50% → 100%
✅ File uploaded successfully on attempt 1
```

### При временном сбое (502 на первой попытке):
```
📝 Attempt 1/3: Requesting NEW upload URL...
✅ Got upload URL for attempt 1
📤 Uploading file to storage (attempt 1)...
❌ Upload failed with status 502
⏳ Waiting 3000ms before next retry with NEW URL...

📝 Attempt 2/3: Requesting NEW upload URL...
✅ Got upload URL for attempt 2
📤 Uploading file to storage (attempt 2)...
Progress: 10% → 50% → 100%
✅ File uploaded successfully on attempt 2
```

**Каждая попытка = свежий URL!**

---

## 🎯 ПОЧЕМУ ЭТО ДОЛЖНО ПОМОЧЬ:

1. **Новый URL каждый раз** = нет конфликта с частично использованным URL
2. **Exponential backoff** = даём Supabase "отдышаться"
3. **Логирование headers** = можем видеть детали 502 для Support
4. **3 попытки** = высокая вероятность успеха даже при нестабильности

---

## 📝 ДЛЯ SUPABASE SUPPORT (если проблема сохранится):

Теперь логи будут более информативные:
```
Response headers: x-request-id: abc123, x-supabase-request-id: xyz789
```

Эти ID помогут Support точно найти проблему в их инфраструктуре.

---

## ✅ ГОТОВО К ТЕСТИРОВАНИЮ!

**Перезагрузи страницу и попробуй загрузить видео:**

1. Cmd + Shift + R
2. Загрузи файл (любой)
3. Смотри console - теперь будут видны все retry с новыми URL

**Должно быть намного стабильнее!** 🚀

---

## 📊 SUMMARY OF FIXES:

| Проблема | Было | Стало |
|----------|------|-------|
| **Retry URL** | Один URL, 3 попытки | НОВЫЙ URL каждую попытку ✅ |
| **Chunk size** | 20 мин (153 MB) | 10 мин (75 MB) ✅ |
| **Logging** | Минимальное | Response headers для диагностики ✅ |
| **Backoff** | Нет | 3s → 6s → 12s ✅ |
| **Expiry** | 60 сек | 30 минут ✅ |

---

**Попробуй сейчас!** Это должно решить проблему intermittent 502! 🎉



