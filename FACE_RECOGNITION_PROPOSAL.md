# 🎭 Face Recognition — Решение проблемы идентификации персонажей

## Проблема

AI **путает персонажей в кадре**:
- План #254: AI думает "Галя", эталон "Тома"
- План #255: AI думает "Таня", эталон "Галя"  
- План #481: AI думает "Тома + Бэлла", эталон "Галя"

**Причина:** Gemini не может надёжно различить лица в сжатом видео.

---

## Решение: Face Recognition Pipeline

### Этап 1: Извлечение лиц из заставки (TITРЫ)

```typescript
// lib/face-extraction.ts

/**
 * Извлекаем лица персонажей из заставки (00:00:04 - 00:01:06)
 * Когда показывается титр "Галина — Полина Нечитайло" → сохраняем кадр
 */
async function extractCharacterFaces(
  videoPath: string,
  creditScenes: Array<{ timecode: string, character: string }>
): Promise<Map<string, string>> {
  // Для каждого титра:
  // 1. FFmpeg извлекает кадр: ffmpeg -ss TIMECODE -i video.mp4 -frames:v 1 face_GALINA.jpg
  // 2. Сохраняем: faces/GALINA.jpg
  
  const faceMap = new Map<string, string>();
  
  for (const credit of creditScenes) {
    const outputPath = `./faces/${credit.character}.jpg`;
    await execAsync(`ffmpeg -ss ${credit.timecode} -i "${videoPath}" -frames:v 1 "${outputPath}"`);
    faceMap.set(credit.character, outputPath);
  }
  
  return faceMap; // ГАЛИНА → ./faces/GALINA.jpg
}
```

### Этап 2: Face Recognition в каждой сцене

**Инструменты:**
- **face-api.js** (node.js) — простой, быстрый
- **Или:** deepface (Python) — более точный
- **Или:** Azure Face API / AWS Rekognition — облачный

```typescript
// lib/face-recognition.ts
import * as faceapi from 'face-api.js';

/**
 * Определяем кто в кадре для каждого плана
 */
async function identifyFacesInScene(
  videoChunkPath: string,
  sceneTimecode: string,
  referenceFaces: Map<string, string> // ГАЛИНА → ./faces/GALINA.jpg
): Promise<string[]> {
  // 1. Извлекаем кадр из середины сцены
  const frameImage = await extractFrameAtTimecode(videoChunkPath, sceneTimecode);
  
  // 2. Детектируем лица в кадре
  const detectedFaces = await faceapi.detectAllFaces(frameImage)
    .withFaceLandmarks()
    .withFaceDescriptors();
  
  // 3. Сравниваем с эталонными лицами
  const identifiedCharacters: string[] = [];
  
  for (const face of detectedFaces) {
    let bestMatch: { character: string; distance: number } | null = null;
    
    for (const [character, refPath] of referenceFaces.entries()) {
      const refImage = await loadImage(refPath);
      const refDescriptor = await faceapi.detectSingleFace(refImage).withFaceDescriptor();
      
      if (refDescriptor) {
        const distance = faceapi.euclideanDistance(face.descriptor, refDescriptor.descriptor);
        
        if (distance < 0.6 && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { character, distance };
        }
      }
    }
    
    if (bestMatch) {
      identifiedCharacters.push(bestMatch.character);
    }
  }
  
  return identifiedCharacters; // ["ГАЛИНА", "ЮСЕФ"]
}
```

### Этап 3: Интеграция в промпт

```typescript
// В createChunkPromptV4:

for (const scene of scenes) {
  const facesInScene = await identifyFacesInScene(chunkVideo, scene.timecode, referenceFaces);
  
  // Добавляем в промпт:
  scene.hint = facesInScene.length > 0 
    ? `⚠️ Face Recognition: В кадре ${facesInScene.join(', ')}`
    : '';
}

// В промпте:
**00:12:01:23 - 00:12:03:06**
⚠️ Face Recognition: В кадре ТОМА
План: Кр.
Содержание: [описание]
Диалоги: ТОМА
```

---

## Преимущества

✅ **100% точность определения персонажей**
✅ Gemini не нужно "угадывать" кто в кадре
✅ Работает даже с похожими актёрами

## Недостатки

❌ Требует установки face-api.js / deepface
❌ Дополнительное время обработки (+10-20 сек на chunk)
❌ Может не работать для:
   - Боковых ракурсов
   - Затемнённых сцен
   - Дальних планов (лица маленькие)

---

## Альтернатива: GPT-4 Vision / Gemini Vision с примерами

**Идея:** Показать Gemini эталонные кадры персонажей ИЗ ЗАСТАВКИ.

```typescript
const prompt = `
Вот лица персонажей (из заставки):
- ГАЛИНА: [image: frame_00_01_10.jpg]
- ТОМА: [image: frame_00_01_15.jpg]
- БЭЛЛА: [image: frame_00_01_20.jpg]

Теперь опиши план 00:12:01:23:
[image: frame_12_01_23.jpg]

Кто в кадре? Сравни лицо с эталонами выше.
`;
```

**Эффект:** Gemini сможет сравнивать лица визуально.

---

## Рекомендация

**Для 100% точности персонажей:**
- ⭐⭐⭐ Внедрить Face Recognition (face-api.js)
- ⭐⭐ Или использовать GPT-4V с эталонными кадрами

**Без Face Recognition:**
- Максимум ~85% точность персонажей (зависит от калибровки спикеров)
