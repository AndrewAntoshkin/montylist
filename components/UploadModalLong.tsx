'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';

interface UploadModalLongProps {
  onClose: () => void;
  onUploadComplete: () => void;
  userId: string;
}

export default function UploadModalLong({
  onClose,
  onUploadComplete,
  userId,
}: UploadModalLongProps) {
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
        const duration = Math.floor(video.duration); // в секундах
        resolve(duration);
      };
      
      video.onerror = () => {
        window.URL.revokeObjectURL(video.src);
        reject(new Error('Не удалось загрузить метаданные видео'));
      };
      
      video.src = URL.createObjectURL(file);
    });
  };

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
      
      // Get video duration
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
      
      // Get video duration
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
    if (!file || !videoDuration) {
      setError('Пожалуйста, выберите видео файл');
      return;
    }

    console.log('🚀 Starting upload:', file.name, 'Duration:', videoDuration);

    setUploading(true);
    setProgress(0);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      formData.append('duration', videoDuration.toString());
      formData.append('skipAutoProcess', 'true'); // Отключаем автоматический процесс

      console.log('📤 Sending upload request...');

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', async () => {
        console.log('📥 Upload response received. Status:', xhr.status);
        
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('✅ Upload response:', response);
            const videoId = response.video?.id;
            
            if (!videoId) {
              console.error('❌ No video ID in response');
              throw new Error('No video ID returned');
            }

            console.log('📹 Video ID:', videoId);
            console.log('🔄 Closing modal and starting chunked processing...');

            // Закрываем модалку сразу, чтобы видеть прогресс
            onUploadComplete();

            // Запускаем обработку в фоне (не ждем)
            console.log('🔗 Fetching signed URL...');
            fetch(`/api/videos/${videoId}`)
              .then(res => res.json())
              .then(videoData => {
                console.log('✅ Got video data:', videoData);
                if (videoData.signedUrl) {
                  console.log('🚀 Starting chunked processing...');
                  // Trigger chunked processing
                  return fetch('/api/process-video-chunked', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      videoId: videoId,
                      videoUrl: videoData.signedUrl,
                      videoDuration: videoDuration,
                    }),
                  });
                }
              })
              .catch(err => {
                console.error('Processing trigger error:', err);
              });
          } catch (err) {
            console.error('Upload response error:', err);
            setError('Ошибка при обработке ответа');
            setUploading(false);
          }
        } else {
          setError('Ошибка при загрузке файла');
          setUploading(false);
        }
      });

      xhr.addEventListener('error', () => {
        setError('Ошибка при загрузке файла');
        setUploading(false);
      });

      xhr.open('POST', '/api/upload');
      xhr.send(formData);
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

  return (
    <>
      {/* Затемненный фон */}
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={(e) => {
          if (!uploading) onClose();
        }}
      />

      {/* Модальное окно */}
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="relative flex gap-4 items-start pointer-events-auto">
          {/* Modal - Ширина: 664px, Высота: 680px */}
          <div className="bg-[#191919] rounded-[24px] w-[664px] h-[680px] p-8 flex flex-col">
            {/* Header */}
            <div className="mb-8">
              <h2 className="text-white text-lg font-medium leading-none tracking-[-0.3962px]">
                Длинное видео
              </h2>
              <p className="text-[#a4a4a4] text-sm mt-2">
                Для видео длиннее 20 минут используется обработка по частям
              </p>
            </div>

            {/* Content - Растет, занимает доступное пространство */}
            <div className="flex-1 flex flex-col">
              {!uploading ? (
                <>
                  {/* Drop Zone */}
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
                        {/* Upload Icon */}
                        <div className="w-6 h-6">
                          <Image
                            src="/icons/upload-icon.svg"
                            alt="Upload"
                            width={24}
                            height={24}
                          />
                        </div>
                        {/* Text */}
                        <p className="text-[#a4a4a4] text-sm font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                          Перетащите в область файл или загрузите с устройства
                        </p>
                        {/* Hidden File Input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="video/*"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        {/* Button */}
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
                        >
                          <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                            Выбрать на устройстве
                          </span>
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-4 w-full px-8">
                        <div className="w-6 h-6">
                          <Image
                            src="/icons/upload-icon.svg"
                            alt="Upload"
                            width={24}
                            height={24}
                          />
                        </div>
                        <div className="text-center w-full">
                          <p className="text-white text-sm font-medium mb-1 truncate px-4">
                            {file.name}
                          </p>
                          <p className="text-[#a4a4a4] text-sm">
                            {formatFileSize(file.size)}
                            {videoDuration && (
                              <span className="ml-2">
                                • {formatDuration(videoDuration)}
                              </span>
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

                  {/* Error message */}
                  {error && (
                    <div className="mt-4 text-red-400 text-sm bg-red-500/10 py-2 px-4 rounded-lg">
                      {error}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Uploading State */}
                  <div className="flex-1 border-2 border-dashed border-[#535353] bg-neutral-800 rounded-2xl flex flex-col items-center justify-center gap-4">
                    {/* Spinner */}
                    <div className="w-10 h-10 relative">
                      <div className="animate-spin">
                        <Image
                          src="/icons/spinner.svg"
                          alt="Loading"
                          width={40}
                          height={40}
                        />
                      </div>
                    </div>
                    <p className="text-[#a4a4a4] text-base font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                      Загрузка и обработка видео...
                    </p>
                    <p className="text-[#767676] text-sm font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                      Это может занять несколько минут
                    </p>
                    
                    {/* Progress Bar */}
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
            </div>

            {/* Footer */}
            <div className="mt-8 flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={uploading && progress < 100}
                className="h-[42px] px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#252525] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                  Отмена
                </span>
              </button>
              <button
                onClick={uploading && progress === 100 ? onClose : handleUpload}
                disabled={!file || (uploading && progress < 100) || !videoDuration}
                className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                  {uploading && progress === 100 ? 'Готово' : 'Продолжить'}
                </span>
              </button>
            </div>
          </div>

          {/* Close Button - Скругленная кнопка с X */}
          <button
            onClick={onClose}
            disabled={uploading && progress < 100}
            className="w-8 h-8 bg-white rounded-[10px] flex items-center justify-center hover:bg-neutral-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <Image src="/icons/close-icon.svg" alt="Close" width={16} height={16} />
          </button>
        </div>
      </div>
    </>
  );
}

