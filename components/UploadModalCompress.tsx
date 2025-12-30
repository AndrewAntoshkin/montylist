'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

interface UploadModalCompressProps {
  onClose: () => void;
  onUploadComplete: () => void;
  userId: string;
}

type ProcessingStage = 'idle' | 'loading-ffmpeg' | 'compressing' | 'uploading' | 'complete';

export default function UploadModalCompress({
  onClose,
  onUploadComplete,
  userId,
}: UploadModalCompressProps) {
  const [file, setFile] = useState<File | null>(null);
  const [compressedFile, setCompressedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [compressionStats, setCompressionStats] = useState<{
    originalSize: number;
    compressedSize: number;
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  // Load FFmpeg on mount
  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        console.log('🔧 Loading FFmpeg.wasm...');
        const ffmpeg = new FFmpeg();
        
        ffmpeg.on('log', ({ message }) => {
          console.log('FFmpeg:', message);
        });
        
        ffmpeg.on('progress', ({ progress: prog }) => {
          if (stage === 'compressing') {
            // FFmpeg progress is 0-1, convert to percentage
            setProgress(Math.round(prog * 100));
          }
        });

        // Load FFmpeg core
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        ffmpegRef.current = ffmpeg;
        setFfmpegLoaded(true);
        console.log('✅ FFmpeg.wasm loaded successfully');
      } catch (err) {
        console.error('❌ Failed to load FFmpeg:', err);
        setError('Не удалось загрузить модуль сжатия видео');
      }
    };

    loadFFmpeg();
  }, [stage]);

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
      } catch (err) {
        console.error('Не удалось получить длительность:', err);
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
      } catch (err) {
        console.error('Не удалось получить длительность:', err);
      }
    } else {
      setError('Пожалуйста, загрузите видео файл');
    }
  };

  const compressVideo = async (inputFile: File): Promise<File> => {
    if (!ffmpegRef.current) {
      throw new Error('FFmpeg не загружен');
    }

    const ffmpeg = ffmpegRef.current;
    const inputName = 'input.mp4';
    const outputName = 'output.mp4';

    try {
      console.log('📝 Writing input file to FFmpeg virtual FS...');
      setStage('compressing');
      setProgress(0);
      
      // Write input file to FFmpeg virtual filesystem
      await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

      const originalSizeMB = inputFile.size / (1024 * 1024);
      console.log(`📊 Original size: ${originalSizeMB.toFixed(2)}MB`);

      // Calculate target bitrate for ~180MB output
      const targetSizeMB = 180;
      const duration = videoDuration || 1200; // fallback to 20 min
      const audioBitrate = 128; // kbps
      const targetBitrate = Math.floor((targetSizeMB * 8192) / duration - audioBitrate);
      
      console.log(`🎯 Target: ${targetSizeMB}MB, Duration: ${duration}s, Bitrate: ${targetBitrate}k`);

      // Run FFmpeg compression (OPTIMIZED FOR SPEED)
      console.log('🗜️  Starting compression (fast mode)...');
      await ffmpeg.exec([
        '-i', inputName,
        '-c:v', 'libx264',
        '-b:v', `${targetBitrate}k`,
        '-maxrate', `${Math.floor(targetBitrate * 1.5)}k`,
        '-bufsize', `${Math.floor(targetBitrate * 2)}k`,
        '-preset', 'ultrafast',  // CHANGED: 'medium' → 'ultrafast' (3-5x faster!)
        '-crf', '30',            // CHANGED: '28' → '30' (slightly more compression)
        '-vf', 'scale=-2:720',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-movflags', '+faststart',
        outputName
      ]);

      // Read compressed file
      console.log('📖 Reading compressed file...');
      const data = await ffmpeg.readFile(outputName);
      
      // Convert to File object
      const blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      const compressedFile = new File(
        [blob],
        inputFile.name.replace(/\.\w+$/, '-compressed.mp4'),
        { type: 'video/mp4' }
      );

      const compressedSizeMB = compressedFile.size / (1024 * 1024);
      console.log(`✅ Compressed size: ${compressedSizeMB.toFixed(2)}MB`);
      
      setCompressionStats({
        originalSize: originalSizeMB,
        compressedSize: compressedSizeMB,
      });

      // Cleanup FFmpeg virtual FS
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      return compressedFile;
    } catch (err) {
      console.error('❌ Compression error:', err);
      throw new Error('Не удалось сжать видео');
    }
  };

  const handleUpload = async () => {
    // Prevent double-click / duplicate submissions
    if (processing) {
      console.log('⚠️  Upload already in progress, ignoring duplicate request');
      return;
    }
    
    if (!file) {
      setError('Пожалуйста, выберите видео файл');
      return;
    }

    if (!ffmpegLoaded) {
      setError('FFmpeg еще загружается, подождите немного');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setError('');

    try {
      // Step 1: Compress video
      console.log('🗜️  Compressing video...');
      setStage('compressing');
      const compressed = await compressVideo(file);
      setCompressedFile(compressed);

      // Step 2: Upload compressed file
      console.log('📤 Uploading compressed file...');
      setStage('uploading');
      setProgress(0);

      // Get upload URL
      const urlResponse = await fetch('/api/create-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: compressed.name,
          fileType: compressed.type,
          fileSize: compressed.size,
        }),
      });

      if (!urlResponse.ok) {
        throw new Error('Failed to create upload URL');
      }

      const { uploadUrl, storagePath } = await urlResponse.json();

      // Upload with XHR for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload error')));

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', compressed.type);
        xhr.send(compressed);
      });

      // Step 3: Complete upload
      console.log('📝 Creating video record...');
      const completeResponse = await fetch('/api/complete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          originalFilename: file.name,
          fileSize: compressed.size,
          duration: videoDuration?.toString() || '0',
          skipAutoProcess: 'true',
        }),
      });

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload');
      }

      const response = await completeResponse.json();
      const videoId = response.video?.id;

      if (!videoId) {
        throw new Error('No video ID returned');
      }

      console.log('✅ Upload complete! Video ID:', videoId);
      setStage('complete');

      // Close modal - processing starts automatically from /api/complete-upload
      onUploadComplete();
      console.log('✅ Chunked processing started automatically in background');

    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
      setProcessing(false);
      setStage('idle');
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

  const getStageText = () => {
    switch (stage) {
      case 'loading-ffmpeg':
        return 'Загрузка модуля сжатия...';
      case 'compressing':
        return 'Сжатие видео...';
      case 'uploading':
        return 'Загрузка на сервер...';
      case 'complete':
        return 'Готово!';
      default:
        return 'Обработка...';
    }
  };

  return (
    <>
      {/* Затемненный фон */}
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={(e) => {
          if (!processing) onClose();
        }}
      />

      {/* Модальное окно */}
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="relative flex gap-4 items-start pointer-events-auto">
          {/* Modal */}
          <div className="bg-[#191919] rounded-[24px] w-[664px] h-[680px] p-8 flex flex-col">
            {/* Header */}
            <div className="mb-8">
              <h2 className="text-white text-lg font-medium leading-none tracking-[-0.3962px]">
                Тестовая загрузка (с сжатием)
              </h2>
              <p className="text-[#a4a4a4] text-sm mt-2">
                {ffmpegLoaded ? '✅ Модуль сжатия готов' : '⏳ Загрузка модуля сжатия...'}
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col">
              {!processing ? (
                <>
                  {/* Drop Zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-colors ${
                      isDragging || file
                        ? 'border-blue-500 bg-blue-900/10'
                        : 'border-[#535353] bg-neutral-800'
                    }`}
                  >
                    {!file ? (
                      <>
                        <div className="w-6 h-6">
                          <Image
                            src="/icons/upload-icon.svg"
                            alt="Upload"
                            width={24}
                            height={24}
                          />
                        </div>
                        <p className="text-[#a4a4a4] text-sm font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                          Перетащите видео или выберите файл
                          <br />
                          <span className="text-blue-400">⚡ Быстрое сжатие до ~180-200 МБ</span>
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
                          disabled={!ffmpegLoaded}
                          className="h-[42px] px-4 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                            Выбрать видео
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
                              <span className="ml-2">• {formatDuration(videoDuration)}</span>
                            )}
                          </p>
                          {compressionStats && (
                            <p className="text-blue-400 text-xs mt-2">
                              Будет сжато: {compressionStats.originalSize.toFixed(1)}MB → ~180MB
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setFile(null);
                            setVideoDuration(null);
                            setCompressionStats(null);
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
                  {/* Processing State */}
                  <div className="flex-1 border-2 border-dashed border-blue-500 bg-blue-900/10 rounded-2xl flex flex-col items-center justify-center gap-4">
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
                    <p className="text-white text-base font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                      {getStageText()}
                    </p>
                    <p className="text-[#767676] text-sm font-medium leading-[1.2] tracking-[-0.3962px] text-center">
                      {stage === 'compressing' 
                        ? 'Быстрое сжатие в браузере (ultrafast mode)'
                        : 'Пожалуйста, подождите'}
                    </p>
                    
                    {/* Progress Bar */}
                    <div className="w-full max-w-md mt-4 px-8">
                      <div className="flex justify-between text-xs text-gray-400 mb-2">
                        <span>{stage === 'compressing' ? 'Сжатие' : 'Загрузка'}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="w-full bg-[#2a2a2a] rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {compressionStats && (
                      <div className="text-[#a4a4a4] text-xs mt-2">
                        Оригинал: {compressionStats.originalSize.toFixed(1)}MB →
                        Сжато: {compressionStats.compressedSize.toFixed(1)}MB
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="mt-8 flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={processing}
                className="h-[42px] px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#252525] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                  {processing ? 'Обработка...' : 'Отмена'}
                </span>
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || processing || !ffmpegLoaded}
                className="h-[42px] px-4 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                  {processing ? 'Обработка...' : 'Начать'}
                </span>
              </button>
            </div>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            disabled={processing}
            className="w-8 h-8 bg-white rounded-[10px] flex items-center justify-center hover:bg-neutral-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <Image src="/icons/close-icon.svg" alt="Close" width={16} height={16} />
          </button>
        </div>
      </div>
    </>
  );
}

