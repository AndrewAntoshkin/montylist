'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DocumentCheckIcon, ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/16/solid';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Video, Profile } from '@/types';
import type { User } from '@supabase/supabase-js';
import TwoStepUploadModal from './TwoStepUploadModal';
import UploadModalV3 from './UploadModalV3';
import UploadModalV4 from './UploadModalV4';
import UploadModalV5 from './UploadModalV5';
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
  const [uploadModalState, setUploadModalState] = useState<{ isOpen: boolean; isLongVideo: boolean }>({
    isOpen: false,
    isLongVideo: false,
  });
  const [isV3ModalOpen, setIsV3ModalOpen] = useState(false);
  const [isV4ModalOpen, setIsV4ModalOpen] = useState(false);
  const [isV5ModalOpen, setIsV5ModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('ready');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <div className="border border-[#3c6f06] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-xs font-medium text-[#3c6f06] leading-none">
              Загружен
            </span>
          </div>
        );
      case 'processing':
      case 'uploading':
        return (
          <div className="border border-[#705d00] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-xs font-medium text-[#705d00] leading-none">
              {status === 'uploading' ? 'Загрузка' : 'Обработка'}
            </span>
          </div>
        );
      case 'error':
        return (
          <div className="border border-[#6f0606] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-xs font-medium text-[#6f0606] leading-none">
              Ошибка
            </span>
          </div>
        );
      default:
        return (
          <div className="border border-[#3c6f06] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-xs font-medium text-[#3c6f06] leading-none">
              Загружен
            </span>
          </div>
        );
    }
  };

  const handleDownload = async (e: React.MouseEvent, videoId: string) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      // Download DOCX file from API
      const response = await fetch(`/api/export-doc/${videoId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `montage_${videoId.substring(0, 8)}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Файл скачан');
    } catch (error) {
      console.error('Error downloading:', error);
      toast.error('Ошибка при скачивании');
    }
  };

  const handleDelete = async (e: React.MouseEvent, videoId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Вы уверены, что хотите удалить это видео и монтажный лист?')) {
      return;
    }

    setDeletingId(videoId);

    try {
      const { error } = await supabase
        .from('videos')
        .delete()
        .eq('id', videoId);

      if (error) throw error;

      toast.success('Видео удалено');
      router.refresh();
    } catch (error) {
      console.error('Error deleting video:', error);
      toast.error('Ошибка при удалении');
      setDeletingId(null);
    }
  };

  const handleUploadComplete = () => {
    setUploadModalState({ isOpen: false, isLongVideo: false });
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
    <div className="flex-1">
      {/* Header */}
      <Header user={user} profile={profile} />

      {/* Main Content */}
      <main className="flex-1">
        <div className="max-w-[1400px] mx-auto px-8 py-6">
          {/* Title and New Buttons */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white text-2xl leading-9 font-medium">
              Монтажные листы
            </h2>
            <div className="flex gap-2">
              {/* СКРЫТО ДЛЯ ДЕМО: Новый лист (short video) */}
              {/* <button
                onClick={() => setUploadModalState({ isOpen: true, isLongVideo: false })}
                className="h-9 px-3 py-2.5 bg-neutral-100 rounded-lg flex items-center justify-center hover:bg-neutral-200 transition-colors"
              >
                <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                  Новый лист
                </span>
              </button> */}
              {/* СКРЫТО ДЛЯ ДЕМО: Длинное видео */}
              {/* <button
                onClick={() => setUploadModalState({ isOpen: true, isLongVideo: true })}
                className="h-9 px-3 py-2.5 bg-[#2c2c2c] border border-[#3ea662] rounded-lg flex items-center justify-center hover:bg-[#3ea662]/10 transition-colors"
              >
                <span className="text-[#3ea662] text-sm font-medium leading-none tracking-[-0.3962px]">
                  Длинное видео
                </span>
              </button> */}
              {/* СКРЫТО ДЛЯ ДЕМО: V3 Создать */}
              {/* <button
                onClick={() => setIsV3ModalOpen(true)}
                className="h-9 px-3 py-2.5 bg-[#2c2c2c] border border-blue-500 rounded-lg flex items-center justify-center hover:bg-blue-500/10 transition-colors"
              >
                <span className="text-blue-500 text-sm font-medium leading-none tracking-[-0.3962px]">
                  Создать
                </span>
              </button> */}
              {/* V4 PyScene — основная кнопка для демо */}
              <button
                onClick={() => setIsV4ModalOpen(true)}
                className="h-9 px-3 py-2.5 bg-neutral-100 rounded-lg flex items-center justify-center hover:bg-neutral-200 transition-colors"
              >
                <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                  Создать
                </span>
              </button>
              
              {/* V5 BETA — улучшенная архитектура */}
              <button
                onClick={() => setIsV5ModalOpen(true)}
                className="h-9 px-3 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg flex items-center justify-center hover:from-cyan-600 hover:to-blue-600 transition-colors"
              >
                <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                  Создать beta
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
                    onClick={() => setUploadModalState({ isOpen: true, isLongVideo: false })}
                    className="px-6 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Загрузить видео
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-5">
                {displayVideos.map((video) => (
                  <Link
                    key={video.id}
                    href={`/dashboard/${video.id}`}
                    className="bg-[#191919] rounded-2xl p-5 flex flex-col gap-5 hover:bg-[#1f1f1f] transition-colors overflow-hidden"
                  >
                    <div className="flex items-start justify-between">
                      {getStatusBadge(video.status)}
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => handleDownload(e, video.id)}
                          disabled={video.status !== 'completed'}
                          className="bg-[#191919] border border-[#2e2e2e] rounded-lg h-8 px-2 flex items-center justify-center hover:bg-[#222] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="text-xs font-medium text-white leading-none">
                            Скачать
                          </span>
                        </button>
                        <button 
                          onClick={(e) => handleDelete(e, video.id)}
                          disabled={deletingId === video.id}
                          className="bg-[#191919] border border-[#2e2e2e] rounded-lg h-8 w-8 p-2 flex items-center justify-center hover:bg-[#222] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === video.id ? (
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M2 4H3.33333M3.33333 4H14M3.33333 4V13.3333C3.33333 13.687 3.47381 14.0261 3.72386 14.2761C3.97391 14.5262 4.31304 14.6667 4.66667 14.6667H11.3333C11.687 14.6667 12.0261 14.5262 12.2761 14.2761C12.5262 14.0261 12.6667 13.687 12.6667 13.3333V4H3.33333ZM5.33333 4V2.66667C5.33333 2.31304 5.47381 1.97391 5.72386 1.72386C5.97391 1.47381 6.31304 1.33333 6.66667 1.33333H9.33333C9.68696 1.33333 10.0261 1.47381 10.2761 1.72386C10.5262 1.97391 10.6667 2.31304 10.6667 2.66667V4M6.66667 7.33333V11.3333M9.33333 7.33333V11.3333" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-base font-semibold leading-6 text-white truncate">
                        {video.original_filename || 'Название фильма'}
                      </p>
                      <p className="text-xs font-normal leading-5 text-[#7e7e7e]">
                        {formatDate(video.created_at)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Upload Modal */}
      {uploadModalState.isOpen && (
        <TwoStepUploadModal
          onClose={() => setUploadModalState({ isOpen: false, isLongVideo: false })}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
          isLongVideo={uploadModalState.isLongVideo}
        />
      )}

      {/* V3 Modal */}
      {isV3ModalOpen && (
        <UploadModalV3
          onClose={() => setIsV3ModalOpen(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
        />
      )}

      {/* V4 Modal (PySceneDetect) */}
      {isV4ModalOpen && (
        <UploadModalV4
          onClose={() => setIsV4ModalOpen(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
        />
      )}

      {/* V5 BETA Modal (Improved Architecture) */}
      {isV5ModalOpen && (
        <UploadModalV5
          onClose={() => setIsV5ModalOpen(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
        />
      )}
    </div>
  );
}


