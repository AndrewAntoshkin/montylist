'use client';

/**
 * Debug Page — тестирование компонентов по отдельности
 */

import { useState, useEffect } from 'react';

interface Video {
  id: string;
  original_filename: string;
  status: string;
  created_at: string;
}

export default function DebugPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [sceneNumber, setSceneNumber] = useState(1);
  const [sceneRange, setSceneRange] = useState({ start: 1, end: 10 });
  const [activeTest, setActiveTest] = useState<string>('');

  // Загружаем список видео
  useEffect(() => {
    fetch('/api/videos')
      .then(r => r.json())
      .then(data => {
        if (data.videos) {
          setVideos(data.videos);
          if (data.videos.length > 0) {
            setSelectedVideo(data.videos[0].id);
          }
        }
      })
      .catch(console.error);
  }, []);

  const runTest = async (testName: string, endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any) => {
    setLoading(true);
    setError('');
    setResult(null);
    setActiveTest(testName);

    try {
      const options: RequestInit = { method };
      if (body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }

      const response = await fetch(endpoint, options);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Request failed');
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <h1 className="text-3xl font-bold mb-8 text-amber-400">🔬 Debug Console</h1>

      {/* Main Layout: Результат слева, Тесты справа */}
      <div className="flex gap-6">
        
        {/* ЛЕВАЯ КОЛОНКА — Выбор видео + Результат */}
        <div className="flex-1 min-w-0">
          {/* Выбор видео */}
          <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <label className="block text-sm text-zinc-400 mb-2">Выберите видео:</label>
            <select
              value={selectedVideo}
              onChange={(e) => setSelectedVideo(e.target.value)}
              className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
            >
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.original_filename} ({v.status})
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 mt-2">ID: {selectedVideo}</p>
          </div>

          {/* Ошибка */}
          {error && (
            <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg">
              <h3 className="text-red-400 font-semibold mb-2">❌ Ошибка</h3>
              <p className="text-red-300">{error}</p>
            </div>
          )}

          {/* Результат */}
          {result && (
            <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
              <h3 className="text-lg font-semibold mb-4 text-emerald-400">
                ✅ Результат: {activeTest}
              </h3>
              
              {/* Краткая статистика */}
              {result.totalScenes && (
                <div className="mb-4 p-3 bg-zinc-800 rounded">
                  <p>📊 Всего сцен: <span className="text-amber-400 font-bold">{result.totalScenes}</span></p>
                  {result.rawScenesCount && (
                    <p>📹 Raw сцен: {result.rawScenesCount}</p>
                  )}
                </div>
              )}

              {result.totalSpeakers && (
                <div className="mb-4 p-3 bg-zinc-800 rounded">
                  <p>🎤 Спикеров: <span className="text-green-400 font-bold">{result.totalSpeakers}</span></p>
                  <p>✅ Откалибровано: {result.calibratedSpeakers}</p>
                  <p>📝 Слов: {result.totalWords}</p>
                </div>
              )}

              {/* Спикеры (для диаризации) */}
              {result.speakers && result.speakers.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm text-zinc-400 mb-2">Спикеры:</h4>
                  <div className="space-y-2">
                    {result.speakers.map((s: any, i: number) => (
                      <div key={i} className="p-3 bg-zinc-800 rounded">
                        <div className="flex justify-between items-start">
                          <span className="text-blue-400 font-bold">Speaker {s.speakerId}</span>
                          <span className={s.characterName.includes('НЕ ОТКАЛИБРОВАН') ? 'text-red-400' : 'text-green-400'}>
                            {s.characterName}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">Слов: {s.wordCount}</p>
                        <p className="text-sm text-zinc-300 mt-1 italic">&ldquo;{s.fullText}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Сцена (для теста сцены) */}
              {result.sceneIndex !== undefined && (
                <div className="mb-4 p-3 bg-zinc-800 rounded">
                  <div className="flex justify-between mb-2">
                    <span className="text-amber-400 font-bold">Сцена #{result.sceneIndex}</span>
                    <span className="text-zinc-400">{result.timecode}</span>
                  </div>
                  <p className="text-sm text-zinc-300 mb-2">{result.description}</p>
                  {result.dialogues && result.dialogues !== 'Музыка' && (
                    <div className="p-2 bg-zinc-900 rounded mt-2">
                      <p className="text-xs text-zinc-500 mb-1">Диалоги:</p>
                      <p className="text-sm text-green-300 whitespace-pre-wrap">{result.dialogues}</p>
                    </div>
                  )}
                  {result.dominantSpeaker && (
                    <p className="text-xs text-zinc-500 mt-2">
                      Доминантный спикер: <span className="text-blue-400">{result.dominantSpeaker}</span>
                    </p>
                  )}
                </div>
              )}

              {result.speakerMapping && result.speakerMapping.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm text-zinc-400 mb-2">Маппинг спикеров:</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {result.speakerMapping.map((m: any, i: number) => (
                      <div key={i} className="p-2 bg-zinc-800 rounded text-sm">
                        <span className="text-blue-400">{m.speakerId}</span>
                        <span className="text-zinc-500"> → </span>
                        <span className="text-green-400">{m.characterName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.validated && (
                <div className="mb-4">
                  <h4 className="text-sm text-zinc-400 mb-2">Валидированные сцены:</h4>
                  <div className="space-y-2">
                    {result.validated.map((s: any, i: number) => (
                      <div key={i} className="p-3 bg-zinc-800 rounded">
                        <div className="flex justify-between">
                          <span className="text-amber-400">#{s.scene}</span>
                          <span className="text-zinc-500">{s.timecode}</span>
                        </div>
                        <p className="text-sm text-zinc-300 mt-1">{s.description}</p>
                        {s.speaker && (
                          <p className="text-sm mt-1">
                            <span className="text-green-400">{s.speaker}:</span>
                            <span className="text-zinc-400 ml-2">{s.dialogue}</span>
                          </p>
                        )}
                        {s.notes && (
                          <p className="text-xs text-zinc-500 mt-1">💡 {s.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Output (для валидатора) */}
              {result.aiOutput && (
                <div className="mb-4">
                  <h4 className="text-sm text-zinc-400 mb-2">AI Output:</h4>
                  <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap overflow-auto max-h-96">
                    {result.aiOutput}
                  </pre>
                </div>
              )}

              {/* Первые/последние таймкоды */}
              {result.firstFive && (
                <div className="mb-4">
                  <h4 className="text-sm text-zinc-400 mb-2">Первые 5 сцен:</h4>
                  <div className="space-y-1 font-mono text-sm">
                    {result.firstFive.map((t: any) => (
                      <div key={t.plan} className="flex gap-4">
                        <span className="text-amber-400 w-8">#{t.plan}</span>
                        <span className="text-blue-400">{t.start}</span>
                        <span className="text-zinc-500">→</span>
                        <span className="text-blue-400">{t.end}</span>
                        <span className="text-zinc-500">({t.duration})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Полный JSON */}
              <details className="mt-4">
                <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                  📋 Полный JSON ответ
                </summary>
                <pre className="mt-2 p-4 bg-zinc-950 rounded overflow-auto max-h-96 text-xs">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Placeholder если нет результата */}
          {!result && !error && !loading && (
            <div className="p-8 bg-zinc-900/50 rounded-lg border border-zinc-800 border-dashed text-center">
              <p className="text-zinc-500">👈 Выберите тест справа</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="p-8 bg-zinc-900 rounded-lg border border-zinc-800 text-center">
              <div className="animate-spin text-4xl mb-4">⏳</div>
              <p className="text-zinc-400">Выполняется: {activeTest}...</p>
            </div>
          )}
        </div>

        {/* ПРАВАЯ КОЛОНКА — Тесты (вертикально) */}
        <div className="w-80 flex-shrink-0 space-y-4">
          
          {/* Тест таймкодов */}
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h3 className="text-lg font-semibold mb-2 text-blue-400">📐 Таймкоды</h3>
            <p className="text-xs text-zinc-500 mb-3">PySceneDetect — все склейки видео</p>
            <button
              onClick={() => runTest('Таймкоды', `/api/test/timecodes?videoId=${selectedVideo}`)}
              disabled={loading || !selectedVideo}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 rounded-lg transition font-medium"
            >
              Тест
            </button>
          </div>

          {/* Тест диаризации */}
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h3 className="text-lg font-semibold mb-2 text-green-400">🎤 Диаризация</h3>
            <p className="text-xs text-zinc-500 mb-3">AssemblyAI — спикеры и их реплики</p>
            <button
              onClick={() => runTest('Диаризация', `/api/test/diarization?videoId=${selectedVideo}&start=0&end=180`)}
              disabled={loading || !selectedVideo}
              className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 rounded-lg transition font-medium"
            >
              Тест (0-3 мин)
            </button>
          </div>

          {/* Тест сцены */}
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h3 className="text-lg font-semibold mb-2 text-purple-400">🎬 Сцена</h3>
            <p className="text-xs text-zinc-500 mb-3">Детальный анализ одной сцены</p>
            <input
              type="number"
              value={sceneNumber}
              onChange={(e) => setSceneNumber(parseInt(e.target.value) || 1)}
              min={1}
              className="w-full p-2 mb-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-center"
              placeholder="№ сцены"
            />
            <button
              onClick={() => runTest(`Сцена #${sceneNumber}`, `/api/test/scene?videoId=${selectedVideo}&scene=${sceneNumber}`)}
              disabled={loading || !selectedVideo}
              className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 rounded-lg transition font-medium"
            >
              Тест сцены #{sceneNumber}
            </button>
          </div>

          {/* Валидатор */}
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h3 className="text-lg font-semibold mb-2 text-amber-400">🧠 Валидатор</h3>
            <p className="text-xs text-zinc-500 mb-3">Gemini собирает всё вместе</p>
            <div className="flex gap-2 mb-3">
              <input
                type="number"
                value={sceneRange.start}
                onChange={(e) => setSceneRange(s => ({ ...s, start: parseInt(e.target.value) || 1 }))}
                min={1}
                className="flex-1 p-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-center"
                placeholder="От"
              />
              <span className="text-zinc-500 self-center">—</span>
              <input
                type="number"
                value={sceneRange.end}
                onChange={(e) => setSceneRange(s => ({ ...s, end: parseInt(e.target.value) || 10 }))}
                min={1}
                className="flex-1 p-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-center"
                placeholder="До"
              />
            </div>
            <button
              onClick={() => runTest(`Валидация ${sceneRange.start}-${sceneRange.end}`, '/api/test/validate', 'POST', {
                videoId: selectedVideo,
                sceneStart: sceneRange.start,
                sceneEnd: sceneRange.end,
              })}
              disabled={loading || !selectedVideo}
              className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-700 rounded-lg transition font-medium"
            >
              Валидировать
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
