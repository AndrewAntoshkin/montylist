'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import type { FilmMetadata, ScriptData } from '@/types';
import * as tus from 'tus-js-client';

interface UploadModalLongProps {
  onClose: () => void;
  onUploadComplete: () => void;
  userId: string;
  filmMetadata?: FilmMetadata | null;
}

type UploadStep = 'script' | 'video';

export default function UploadModalLong({
  onClose,
  onUploadComplete,
  userId,
  filmMetadata,
}: UploadModalLongProps) {
  // Шаг загрузки
  const [currentStep, setCurrentStep] = useState<UploadStep>('script');
  
  // Сценарий
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const scriptInputRef = useRef<HTMLInputElement>(null);
  
  // Видео
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get video duration from file metadata
  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        const duration = Math.floor(video.duration);
        resolve(duration);
      };
      
      video.onerror = () => {
        window.URL.revokeObjectURL(video.src);
        reject(new Error('Не удалось загрузить метаданные видео'));
      };
      
      video.src = URL.createObjectURL(file);
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // Обработка сценария
  // ═══════════════════════════════════════════════════════════════

  const handleScriptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    const filename = selectedFile.name.toLowerCase();
    if (!filename.endsWith('.doc') && !filename.endsWith('.docx') && !filename.endsWith('.txt')) {
      setScriptError('Поддерживаются только .doc, .docx и .txt файлы');
      return;
    }
    
    setScriptFile(selectedFile);
    setScriptError('');
    setScriptLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const response = await fetch('/api/parse-script', {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка при парсинге сценария');
      }
      
      setScriptData(result.scriptData);
      console.log('📋 Script parsed:', result.summary);
      
    } catch (err) {
      console.error('Script parse error:', err);
      setScriptError(err instanceof Error ? err.message : 'Ошибка при парсинге');
      setScriptFile(null);
    } finally {
      setScriptLoading(false);
    }
  };

  const handleScriptDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;
    
    const filename = droppedFile.name.toLowerCase();
    if (!filename.endsWith('.doc') && !filename.endsWith('.docx') && !filename.endsWith('.txt')) {
      setScriptError('Поддерживаются только .doc, .docx и .txt файлы');
      return;
    }
    
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(droppedFile);
    if (scriptInputRef.current) {
      scriptInputRef.current.files = dataTransfer.files;
      scriptInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const skipScript = () => {
    setCurrentStep('video');
  };

  const goToVideo = () => {
    setCurrentStep('video');
  };

  const goBackToScript = () => {
    setCurrentStep('script');
  };

  // ═══════════════════════════════════════════════════════════════
  // Обработка видео
  // ═══════════════════════════════════════════════════════════════

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile);
      setError('');
      
      try {
        const duration = await getVideoDuration(droppedFile);
        setVideoDuration(duration);
        console.log('Длительность видео:', duration, 'секунд');
      } catch (err) {
        console.error('Не удалось получить длительность:', err);
        setError('Не удалось определить длительность видео');
      }
    } else {
      setError('Пожалуйста, загрузите видео файл');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type.startsWith('video/')) {
      setFile(selectedFile);
      setError('');
      
      try {
        const duration = await getVideoDuration(selectedFile);
        setVideoDuration(duration);
        console.log('Длительность видео:', duration, 'секунд');
      } catch (err) {
        console.error('Не удалось получить длительность:', err);
        setError('Не удалось определить длительность видео');
      }
    } else {
      setError('Пожалуйста, загрузите видео файл');
    }
  };

  const handleUpload = async () => {
    if (uploading) {
      console.log('⚠️  Upload already in progress, ignoring duplicate request');
      return;
    }
    
    if (!file || !videoDuration) {
      setError('Пожалуйста, выберите видео файл');
      return;
    }

    const fileSizeMB = file.size / (1024 * 1024);
    const USE_TUS_THRESHOLD_MB = 100; // Используем TUS только для файлов >100MB
    
    console.log('🚀 Starting upload:', file.name, 'Duration:', videoDuration, 'Size:', fileSizeMB.toFixed(2), 'MB');
    if (scriptData) {
      console.log('📋 With script data:', scriptData.characters.length, 'characters');
    }

    setUploading(true);
    setProgress(0);
    setError('');

    try {
      const supabase = createClient();
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }
      
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const uniqueFilename = `${timestamp}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const storagePath = `${userId}/${uniqueFilename}`;
      
      let finalStoragePath: string;
      
      // Для файлов <100MB используем быстрый SDK upload, для больших - TUS
      if (fileSizeMB < USE_TUS_THRESHOLD_MB) {
        console.log(`⚡ Using FAST SDK upload (file < ${USE_TUS_THRESHOLD_MB}MB)`);
        
        // Быстрый upload через SDK с XHR для прогресса
        finalStoragePath = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          // Получаем signed upload URL
          fetch('/api/create-upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              fileType: file.type,
              fileSize: file.size,
            }),
          })
          .then(res => res.json())
          .then(({ uploadUrl, storagePath: path }) => {
            if (!uploadUrl) {
              reject(new Error('Failed to get upload URL'));
              return;
            }
            
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const percentage = Math.round((e.loaded / e.total) * 100);
                setProgress(percentage);
              }
            });
            
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                console.log('✅ Fast upload completed!');
                setProgress(100);
                resolve(path);
              } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
              }
            });
            
            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            
            xhr.open('PUT', uploadUrl);
            xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
            xhr.send(file);
          })
          .catch(reject);
        });
        
      } else {
        console.log(`📦 Using TUS resumable upload (file >= ${USE_TUS_THRESHOLD_MB}MB)`);
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const projectId = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1];
        
        if (!projectId) {
          throw new Error('Could not extract project ID from Supabase URL');
        }
        
        finalStoragePath = await new Promise<string>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            headers: {
              authorization: `Bearer ${session.access_token}`,
              'x-upsert': 'false',
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
              bucketName: 'videos',
              objectName: storagePath,
              contentType: file.type || 'video/mp4',
              cacheControl: '3600',
            },
            chunkSize: 6 * 1024 * 1024,
            onError: (error) => {
              console.error('❌ TUS upload failed:', error);
              reject(error);
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
              setProgress(percentage);
            },
            onSuccess: () => {
              console.log('✅ TUS upload completed!');
              setProgress(100);
              resolve(storagePath);
            },
          });
          
          upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          }).catch(reject);
        });
      }
      
      // Complete upload with script data
      console.log('📝 Creating video record...');
      
      const enrichedMetadata = {
        ...filmMetadata,
        scriptData: scriptData || undefined,
      };
      
      const completeResponse = await fetch('/api/complete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: finalStoragePath,
          originalFilename: file.name,
          fileSize: file.size,
          duration: videoDuration.toString(),
          skipAutoProcess: 'true',
          filmMetadata: enrichedMetadata,
          scriptData: scriptData,
        }),
      });

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload');
      }

      const response = await completeResponse.json();
      console.log('✅ Video record created:', response);
      
      onUploadComplete();
      console.log('✅ Chunked processing started automatically in background');
    } catch (err) {
      setError('Произошла ошибка при загрузке');
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}ч ${minutes}м ${secs}с`;
    } else if (minutes > 0) {
      return `${minutes}м ${secs}с`;
    } else {
      return `${secs}с`;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Рендер шага загрузки сценария
  // ═══════════════════════════════════════════════════════════════
  
  const renderScriptStep = () => (
    <>
      {/* Шаг индикатор */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
            <span className="text-black text-xs font-bold">1</span>
          </div>
          <span className="text-white text-sm">Сценарий</span>
        </div>
        <div className="w-8 h-px bg-[#535353]" />
        <div className="flex items-center gap-1.5 opacity-50">
          <div className="w-6 h-6 rounded-full bg-[#535353] flex items-center justify-center">
            <span className="text-white text-xs font-bold">2</span>
          </div>
          <span className="text-[#a4a4a4] text-sm">Видео</span>
        </div>
      </div>

      {/* Drop Zone для сценария */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleScriptDrop}
        className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : scriptData
            ? 'border-green-500/50 bg-green-500/10'
            : 'border-[#535353] bg-neutral-800'
        }`}
      >
        {scriptLoading ? (
          <>
            <div className="w-10 h-10 relative">
              <div className="animate-spin">
                <Image src="/icons/spinner.svg" alt="Loading" width={40} height={40} />
              </div>
            </div>
            <p className="text-[#a4a4a4] text-sm">Анализ сценария...</p>
          </>
        ) : scriptData ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <Image src="/icons/check-circle-filled.svg" alt="Done" width={24} height={24} />
            </div>
            <div className="text-center">
              <p className="text-white text-base font-medium mb-1">
                {scriptData.title || scriptFile?.name || 'Сценарий'}
              </p>
              <p className="text-green-400 text-sm">
                ✓ Найдено {scriptData.characters.length} персонажей
              </p>
            </div>
            
            {scriptData.characters.filter(c => c.dialogueCount >= 5).length > 0 && (
              <div className="mt-2 px-4 py-2 bg-[#252525] rounded-lg max-w-md">
                <p className="text-[#a4a4a4] text-xs mb-1">Главные персонажи:</p>
                <p className="text-white text-sm">
                  {scriptData.characters
                    .filter(c => c.dialogueCount >= 5)
                    .slice(0, 5)
                    .map(c => c.name)
                    .join(', ')}
                  {scriptData.characters.filter(c => c.dialogueCount >= 5).length > 5 && '...'}
                </p>
              </div>
            )}
            
            <button
              onClick={() => {
                setScriptFile(null);
                setScriptData(null);
              }}
              className="text-[#a4a4a4] text-sm hover:text-white transition-colors"
            >
              Загрузить другой
            </button>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-2xl">📄</span>
            </div>
            <div className="text-center">
              <p className="text-white text-base font-medium mb-1">
                Загрузите сценарий
              </p>
              <p className="text-[#a4a4a4] text-sm">
                Это поможет точно определить персонажей
              </p>
            </div>
            
            <input
              ref={scriptInputRef}
              type="file"
              accept=".doc,.docx,.txt"
              onChange={handleScriptSelect}
              className="hidden"
            />
            
            <div className="flex gap-2">
              <button
                onClick={() => scriptInputRef.current?.click()}
                className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
              >
                <span className="text-black text-sm font-medium">
                  Выбрать файл сценария
                </span>
              </button>
            </div>
            
            <p className="text-[#767676] text-xs mt-2">
              Поддерживаемые форматы: DOC, DOCX, TXT
            </p>
          </>
        )}
      </div>

      {scriptError && (
        <div className="mt-4 text-red-400 text-sm bg-red-500/10 py-2 px-4 rounded-lg">
          {scriptError}
        </div>
      )}
    </>
  );

  // ═══════════════════════════════════════════════════════════════
  // Рендер шага загрузки видео
  // ═══════════════════════════════════════════════════════════════
  
  const renderVideoStep = () => (
    <>
      {/* Шаг индикатор */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
            scriptData ? 'bg-green-500' : 'bg-[#535353]'
          }`}>
            {scriptData ? (
              <span className="text-white text-xs">✓</span>
            ) : (
              <span className="text-white text-xs font-bold">1</span>
            )}
          </div>
          <span className={`text-sm ${scriptData ? 'text-green-400' : 'text-[#a4a4a4]'}`}>
            {scriptData ? `${scriptData.characters.length} персонажей` : 'Пропущено'}
          </span>
        </div>
        <div className="w-8 h-px bg-[#535353]" />
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
            <span className="text-black text-xs font-bold">2</span>
          </div>
          <span className="text-white text-sm">Видео</span>
        </div>
      </div>

      {!uploading ? (
        <>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors ${
              isDragging || file
                ? 'border-[#535353] bg-neutral-800'
                : 'border-[#535353] bg-neutral-800'
            }`}
          >
            {!file ? (
              <>
                <div className="w-6 h-6">
                  <Image src="/icons/upload-icon.svg" alt="Upload" width={24} height={24} />
                </div>
                <p className="text-[#a4a4a4] text-sm font-medium text-center">
                  Перетащите в область файл или загрузите с устройства
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  <span className="text-black text-sm font-medium">
                    Выбрать на устройстве
                  </span>
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full px-8">
                <div className="w-6 h-6">
                  <Image src="/icons/upload-icon.svg" alt="Upload" width={24} height={24} />
                </div>
                <div className="text-center w-full">
                  <p className="text-white text-sm font-medium mb-1 truncate px-4">
                    {file.name}
                  </p>
                  <p className="text-[#a4a4a4] text-sm">
                    {formatFileSize(file.size)}
                    {videoDuration && (
                      <span className="ml-2">• {formatDuration(videoDuration)}</span>
                    )}
                  </p>
                  {videoDuration && videoDuration > 1200 && (
                    <p className="text-[#3ea662] text-xs mt-2">
                      ✓ Будет обработано по частям (оптимально для длинных видео)
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setVideoDuration(null);
                  }}
                  className="text-[#a4a4a4] text-sm hover:text-white transition-colors"
                >
                  Удалить
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 text-red-400 text-sm bg-red-500/10 py-2 px-4 rounded-lg">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex-1 border-2 border-dashed border-[#535353] bg-neutral-800 rounded-2xl flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 relative">
              <div className="animate-spin">
                <Image src="/icons/spinner.svg" alt="Loading" width={40} height={40} />
              </div>
            </div>
            <p className="text-[#a4a4a4] text-base font-medium text-center">
              Загрузка и обработка видео...
            </p>
            <p className="text-[#767676] text-sm font-medium text-center">
              Это может занять несколько минут
            </p>
            
            <div className="w-full max-w-md mt-4 px-8">
              <div className="flex justify-between text-xs text-gray-400 mb-2">
                <span className="truncate max-w-[300px]">{file?.name}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-[#2a2a2a] rounded-full h-1.5">
                <div
                  className="bg-[#3ea662] h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  // ═══════════════════════════════════════════════════════════════
  // Основной рендер
  // ═══════════════════════════════════════════════════════════════
  
  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={(e) => {
          if (!uploading && !scriptLoading) onClose();
        }}
      />

      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="relative flex gap-4 items-start pointer-events-auto">
          <div className="bg-[#191919] rounded-[24px] w-[664px] h-[680px] p-8 flex flex-col">
            {/* Header */}
            <div className="mb-4">
              <h2 className="text-white text-lg font-medium leading-none tracking-[-0.3962px]">
                Длинное видео
              </h2>
              <p className="text-[#767676] text-sm mt-2">
                {currentStep === 'script' 
                  ? 'Шаг 1: Загрузите сценарий для точного определения персонажей'
                  : 'Шаг 2: Загрузите видео для создания монтажного листа'
                }
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col">
              {currentStep === 'script' ? renderScriptStep() : renderVideoStep()}
            </div>

            {/* Footer */}
            <div className="mt-6 flex gap-2 justify-between">
              <div>
                {currentStep === 'video' && !uploading && (
                  <button
                    onClick={goBackToScript}
                    className="h-[42px] px-4 text-[#a4a4a4] hover:text-white transition-colors"
                  >
                    ← Назад к сценарию
                  </button>
                )}
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={uploading || scriptLoading}
                  className="h-[42px] px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#252525] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-white text-sm font-medium">Отмена</span>
                </button>
                
                {currentStep === 'script' ? (
                  <>
                    <button
                      onClick={skipScript}
                      className="h-[42px] px-4 bg-[#252525] rounded-lg hover:bg-[#303030] transition-colors"
                    >
                      <span className="text-white text-sm font-medium">Пропустить</span>
                    </button>
                    <button
                      onClick={goToVideo}
                      disabled={scriptLoading}
                      className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50"
                    >
                      <span className="text-black text-sm font-medium">
                        {scriptData ? 'Продолжить' : 'Далее без сценария'}
                      </span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={uploading && progress === 100 ? onClose : handleUpload}
                    disabled={!file || (uploading && progress < 100) || !videoDuration}
                    className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-black text-sm font-medium">
                      {uploading && progress === 100 
                        ? 'Готово' 
                        : scriptData 
                          ? 'Загрузить и обработать' 
                          : 'Продолжить'
                      }
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={uploading || scriptLoading}
            className="w-8 h-8 bg-white rounded-[10px] flex items-center justify-center hover:bg-neutral-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <Image src="/icons/close-icon.svg" alt="Close" width={16} height={16} />
          </button>
        </div>
      </div>
    </>
  );
}
