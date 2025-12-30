# 🔧 Где найти CORS настройки в Supabase Dashboard

## 📍 ТОЧНАЯ ИНСТРУКЦИЯ:

### Вариант 1: Storage → Configuration

1. В левом меню кликни **Storage** (иконка папки)
2. Справа вверху найди **шестерёнку** (Configuration)
3. Кликни на шестерёнку
4. Ищи раздел **"CORS Configuration"** или **"Allowed Origins"**

Если есть - добавь:
```
Allowed Origins: http://localhost:3000
Methods: GET, POST, PUT, DELETE, OPTIONS
Headers: Content-Type, Authorization, x-upsert
```

### Вариант 2: Project Settings → API

1. Внизу слева кликни **шестерёнку** (Settings)
2. Выбери **API** в левом подменю
3. Прокрути вниз до **"CORS"** или **"Allowed Origins"**
4. Добавь: `http://localhost:3000`

### Вариант 3: Authentication → URL Configuration

1. **Authentication** в левом меню
2. **URL Configuration**
3. **Additional Redirect URLs** или **Site URL**
4. Хотя это для Auth, может повлиять на общие CORS

---

## 💡 ЕСЛИ НЕ НАЙДЁШЬ CORS:

**На Pro плане CORS обычно открыт для всех origins!**

Проблема скорее всего не в Dashboard CORS, а в том что мы **не добавляли CORS headers в наш API endpoint** `/api/create-upload-url`.

Я это уже исправил! ✅

---

## ✅ ЧТО УЖЕ СДЕЛАНО (код):

### `app/api/create-upload-url/route.ts`:

```typescript
// Добавлены CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Добавлен OPTIONS handler
export async function OPTIONS(request) {
  return NextResponse.json({}, { headers: corsHeaders });
}

// POST возвращает CORS headers
export async function POST(request) {
  // ...
  return NextResponse.json(data, { headers: corsHeaders });
}
```

---

## 🧪 ТЕСТИРУЙ СЕЙЧАС:

**Перезагрузи страницу и попробуй загрузить упавшие видео:**

1. Cmd + Shift + R
2. Загрузи `_видео.mp4` или `PP651...mov`
3. Смотри console

**Должно работать!** CORS headers теперь есть в нашем API.

---

## 📊 ПОЧЕМУ НЕКОТОРЫЕ ВИДЕО РАБОТАЛИ:

**Рандомность Supabase Storage:**
- Некоторые запросы попадают на healthy ноды → работают ✅
- Некоторые на проблемные ноды → 502 ❌

**Но с CORS headers в нашем API** - должно быть стабильнее!

---

**Попробуй сейчас!** 🚀



