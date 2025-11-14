'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentCheckIcon, ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/16/solid';
import { toast } from 'sonner';
import type { Video, Profile } from '@/types';
import type { User } from '@supabase/supabase-js';
import VideoCard from './VideoCard';
import UploadModal from './UploadModal';
import UploadModalLong from './UploadModalLong';
import Header from './Header';

interface DashboardClientProps {
  videos: Video[];
  user: User;
  profile: Profile | null;
}

type TabType = 'ready' | 'processing' | 'errors';

export default function DashboardClient({
  videos: initialVideos,
  user,
  profile,
}: DashboardClientProps) {
  const [videos, setVideos] = useState<Video[]>(initialVideos);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploadModalLongOpen, setIsUploadModalLongOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('ready');
  const router = useRouter();
  const previousVideosRef = useRef<Video[]>(initialVideos);

  // Separate videos by status
  const readyVideos = videos.filter((v) => v.status === 'completed');
  const processingVideos = videos.filter((v) =>
    ['uploading', 'processing'].includes(v.status)
  );
  const errorVideos = videos.filter((v) => v.status === 'error');

  const displayVideos =
    activeTab === 'ready'
      ? readyVideos
      : activeTab === 'processing'
      ? processingVideos
      : errorVideos;

  // Update videos state when initialVideos changes
  useEffect(() => {
    setVideos(initialVideos);
  }, [initialVideos]);

  // Check for newly completed videos and show toast
  useEffect(() => {
    const previousVideos = previousVideosRef.current;
    
    // Найти видео, которые изменили статус на 'completed'
    initialVideos.forEach((video) => {
      const previousVideo = previousVideos.find((v) => v.id === video.id);
      
      if (previousVideo && 
          previousVideo.status !== 'completed' && 
          video.status === 'completed') {
        // Сокращаем название файла если оно слишком длинное
        const fileName = video.original_filename || 'Видео';
        const shortName = fileName.length > 50 
          ? fileName.substring(0, 50) + '...' 
          : fileName;
        
        // Видео завершило обработку!
        toast.success('Видео обработано!', {
          description: `${shortName} готов к просмотру`,
          duration: 5000,
        });
      }
    });
    
    // Обновляем reference
    previousVideosRef.current = initialVideos;
  }, [initialVideos]);

  // Poll for video status updates - продолжаем обновлять пока есть видео в обработке
  useEffect(() => {
    if (processingVideos.length === 0) return;

    // Обновляем каждые 3 секунды
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [processingVideos.length, router]);

  // Дополнительное обновление при монтировании компонента
  useEffect(() => {
    // Обновляем сразу при загрузке если есть видео в обработке
    if (processingVideos.length > 0) {
      router.refresh();
    }
  }, []);

  const handleUploadComplete = () => {
    setIsUploadModalOpen(false);
    setIsUploadModalLongOpen(false);
    // Переключаем на таб "В работе" чтобы показать загруженное видео
    setActiveTab('processing');
    // Показываем уведомление о начале обработки
    toast.info('Видео загружено', {
      description: 'Начинается обработка через AI',
      duration: 4000,
    });
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#191919]">
      {/* Header */}
      <Header user={user} profile={profile} />

      {/* Main Content */}
      <main className="pt-[62px] min-h-screen bg-[#101010]">
        <div className="max-w-[1400px] mx-auto px-8 py-6">
          {/* Title and New Buttons */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white text-2xl leading-9 font-medium">
              Монтажные листы
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="h-9 px-3 py-2.5 bg-neutral-100 rounded-lg flex items-center justify-center hover:bg-neutral-200 transition-colors"
              >
                <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                  Новый лист
                </span>
              </button>
              <button
                onClick={() => setIsUploadModalLongOpen(true)}
                className="h-9 px-3 py-2.5 bg-[#2c2c2c] border border-[#3ea662] rounded-lg flex items-center justify-center hover:bg-[#3ea662]/10 transition-colors"
              >
                <span className="text-[#3ea662] text-sm font-medium leading-none tracking-[-0.3962px]">
                  Длинное видео
                </span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-[#2e2e2e] flex gap-2 items-end mb-8">
            {/* Готово Tab */}
            <button
              onClick={() => setActiveTab('ready')}
              className={`flex items-end gap-2 px-0 py-2.5 ${
                activeTab === 'ready' ? 'border-b-2 border-white' : ''
              }`}
            >
              <div className="flex items-center gap-2 px-2 py-1 rounded-md">
                <DocumentCheckIcon className="w-4 h-4 text-[#9b9b9b]" />
                <span className={`text-sm leading-5 ${activeTab === 'ready' ? 'text-white font-medium' : 'text-white font-normal'}`}>
                  Готово
                </span>
                <div className="h-[18px] px-1.5 bg-[#2c2c2c] rounded-sm flex items-center justify-center">
                  <span className="text-white text-xs font-medium leading-5">
                    {readyVideos.length}
                  </span>
                </div>
              </div>
            </button>

            {/* В работе Tab */}
            <button
              onClick={() => setActiveTab('processing')}
              className={`flex items-end gap-2 px-0 py-2.5 ${
                activeTab === 'processing' ? 'border-b-2 border-white' : ''
              }`}
            >
              <div className="flex items-center gap-2 px-2 py-1 rounded-md">
                <ArrowPathIcon className="w-4 h-4 text-[#9b9b9b]" />
                <span className={`text-sm leading-5 ${activeTab === 'processing' ? 'text-white font-medium' : 'text-white font-normal'}`}>
                  В работе
                </span>
                <div className="h-[18px] px-1.5 bg-[#2c2c2c] rounded-sm flex items-center justify-center">
                  <span className="text-white text-xs font-medium leading-5">
                    {processingVideos.length}
                  </span>
                </div>
              </div>
            </button>

            {/* Ошибки Tab */}
            <button
              onClick={() => setActiveTab('errors')}
              className={`flex items-end gap-2 px-0 py-2.5 ${
                activeTab === 'errors' ? 'border-b-2 border-white' : ''
              }`}
            >
              <div className="flex items-center gap-2 px-2 py-1 rounded-md">
                <ExclamationCircleIcon className="w-4 h-4 text-[#9b9b9b]" />
                <span className={`text-sm leading-5 ${activeTab === 'errors' ? 'text-white font-medium' : 'text-white font-normal'}`}>
                  Ошибки
                </span>
                <div className="h-[18px] px-1.5 bg-[#2c2c2c] rounded-sm flex items-center justify-center">
                  <span className="text-white text-xs font-medium leading-5">
                    {errorVideos.length}
                  </span>
                </div>
              </div>
            </button>
          </div>

          {/* Video Grid */}
          <div className="pt-2">
            {displayVideos.length === 0 ? (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-[#191919] rounded-full mb-4">
                  <svg
                    className="w-8 h-8 text-gray-500"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-2">
                  Нет {activeTab === 'ready' ? 'готовых' : activeTab === 'processing' ? 'обрабатываемых' : 'ошибочных'} монтажных листов
                </h3>
                <p className="text-gray-400 mb-6">
                  {activeTab === 'ready'
                    ? 'Загрузите видео, чтобы начать создание монтажного листа'
                    : activeTab === 'processing'
                    ? 'Загруженные видео появятся здесь во время обработки'
                    : 'Видео с ошибками обработки появятся здесь'}
                </p>
                {activeTab === 'ready' && (
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="px-6 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Загрузить видео
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-5">
                {displayVideos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <UploadModal
          onClose={() => setIsUploadModalOpen(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
        />
      )}

      {/* Upload Modal Long */}
      {isUploadModalLongOpen && (
        <UploadModalLong
          onClose={() => setIsUploadModalLongOpen(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
        />
      )}
    </div>
  );
}

