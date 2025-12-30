'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import UploadModalLong from './UploadModalLong';
import GradientBorder from './GradientBorder';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { FilmMetadata } from '@/types';

interface Video {
  id: string;
  title: string;
  created_at: string;
  status: string;
}

interface HomeClientProps {
  user?: User | null;
  recentVideos?: Video[];
  filmMetadata?: FilmMetadata | null;
}

export default function HomeClient({ user, recentVideos = [], filmMetadata }: HomeClientProps) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

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

  const handleUploadComplete = () => {
    setShowUploadModal(false);
    window.location.reload();
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
    } catch (error) {
      console.error('Error downloading:', error);
      alert('Ошибка при скачивании');
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

      router.refresh();
    } catch (error) {
      console.error('Error deleting video:', error);
      alert('Ошибка при удалении');
      setDeletingId(null);
    }
  };

  // Render video card with gradient border for processing status
  const renderVideoCard = (video: Video) => {
    const isProcessing = video.status === 'processing' || video.status === 'uploading';
    
    const cardContent = (
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
    );

    const innerContent = (
      <div className="flex flex-col gap-5">
        {cardContent}
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold leading-6 text-white truncate">
            {video.title || 'Название фильма'}
          </p>
          <p className="text-xs font-normal leading-5 text-[#7e7e7e]">
            {formatDate(video.created_at)}
          </p>
        </div>
      </div>
    );

    if (video.status === 'completed') {
      return (
        <Link
          key={video.id}
          href={`/dashboard/${video.id}`}
          className="bg-[#191919] rounded-2xl p-5 hover:bg-[#1f1f1f] transition-colors overflow-hidden"
        >
          {innerContent}
        </Link>
      );
    }

    if (isProcessing) {
      return (
        <GradientBorder key={video.id}>
          <div className="bg-[#191919] rounded-2xl p-5">
            {innerContent}
          </div>
        </GradientBorder>
      );
    }

    return (
      <div key={video.id} className="bg-[#191919] rounded-2xl p-5 overflow-hidden">
        {innerContent}
      </div>
    );
  };

  return (
    <div className="flex-1">
      <div className="max-w-[1400px] mx-auto px-8 py-6 flex flex-col gap-10">
        
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-8 pt-20 pb-10 max-w-[880px] mx-auto w-full">
          <div className="flex flex-col gap-2 text-center text-white w-full">
            <h1 className="text-[28px] font-semibold leading-[36px]">
              Монтажные листы за минуты
            </h1>
            <p className="text-base font-normal leading-6">
              Загрузите сценарий и видео — получите монтажный лист
            </p>
          </div>

          {/* Upload Area */}
          <div className="flex flex-col gap-4 items-center w-full">
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-[#181818] border-2 border-dashed border-[#535353] rounded-3xl w-[600px] px-2 py-12 flex flex-col items-center gap-4 hover:border-[#666] transition-colors cursor-pointer overflow-hidden"
            >
              <div className="w-10 h-10">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M33.3333 26.6667V30C33.3333 31.7681 31.8682 33.3333 30 33.3333H10C8.13192 33.3333 6.66667 31.7681 6.66667 30V26.6667M26.6667 13.3333L20 6.66667M20 6.66667L13.3333 13.3333M20 6.66667V26.6667" stroke="#A4A4A4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="text-sm font-normal leading-5 text-[#a4a4a4] text-center whitespace-pre-wrap">
                Перетащите в область файл или загрузите с устройства
              </p>
              <div className="bg-neutral-100 px-4 py-2.5 rounded-lg h-[42px] flex items-center justify-center">
                <span className="text-sm font-medium text-black tracking-[-0.3962px]">
                  Выбрать на устройстве
                </span>
              </div>
            </button>

            <div className="flex flex-col gap-2 text-center w-full">
              <p className="text-sm font-medium leading-5 text-[lightgrey]">
                Поддерживаемые форматы: MP4, MOV, AVI
              </p>
              <p className="text-xs font-normal leading-[18px] text-[#a4a4a4]">
                На выходе получите файл готовый по ГОСТУ для Архива кино
              </p>
            </div>
          </div>
        </div>

        {/* Recent Files Section */}
        {recentVideos && recentVideos.length > 0 && (
          <div className="flex flex-col gap-4 w-full">
            <div className="flex flex-col gap-2 w-full">
              <p className="text-xs font-medium leading-5 text-[#656565] uppercase">
                Недавние файлы
              </p>
              
              {/* Grid with videos */}
              <div className="flex flex-col gap-5">
                {/* Row 1 */}
                <div className="grid grid-cols-3 gap-5 w-full">
                  {recentVideos.slice(0, 3).map((video) => renderVideoCard(video))}
                </div>
                
                {/* Row 2 */}
                {recentVideos.length > 3 && (
                  <div className="grid grid-cols-3 gap-5 w-full">
                    {recentVideos.slice(3, 6).map((video) => renderVideoCard(video))}
                  </div>
                )}
              </div>
            </div>

            {/* See All Button */}
            <Link
              href="/dashboard"
              className="border border-[#2e2e2e] rounded-xl px-4 py-5 flex items-center justify-center hover:bg-[#191919] transition-colors w-full"
            >
              <span className="text-sm font-medium text-white leading-none">
                Смотреть все листы
              </span>
            </Link>
          </div>
        )}

        {/* How It Works Section */}
        <div className="flex flex-col gap-6 items-center py-16 w-full">
          <p className="font-semibold text-[24px] leading-[1.2] text-center text-white w-full">
            Как это работает?
          </p>
          
          <div className="flex gap-8 items-center w-full">
            {/* Step 1 - Загрузите сценарий и видео */}
            <div className="flex-1">
              <div className="bg-[#191919] flex flex-col gap-6 p-8 rounded-[44px] h-full items-center justify-center">
                <div className="bg-[#101010] flex flex-col gap-2 items-center justify-center px-8 py-12 rounded-[24px] w-full h-[244px]">
                  <Image
                    src="/step-1.png"
                    alt="Загрузите сценарий и видео"
                    width={381}
                    height={244}
                    className="object-contain h-full"
                  />
                </div>
                <div className="flex flex-col gap-5 w-full">
                  <div className="flex flex-col gap-2 w-full">
                    <p className="font-medium text-[12px] leading-5 text-[#656565] uppercase">
                      Шаг 1
                    </p>
                    <div className="flex gap-2 items-center w-full">
                      <p className="font-semibold text-[16px] leading-[1.2] text-white whitespace-nowrap">
                        Загрузите сценарий и видео
                      </p>
                    </div>
                    <div className="flex flex-col font-medium text-[14px] text-[#909090] w-full">
                      <p className="leading-5">Просто перетащите ваш видеофайл в окно загрузки или выберите файл на компьютере. Поддерживаются форматы: MP4, MOV, AVI. Максимальный размер — 500 МБ.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 - Дождитесь обработки */}
            <div className="flex-1">
              <div className="bg-[#191919] flex flex-col gap-6 h-full items-center justify-center p-8 rounded-[44px]">
                <div className="bg-[#101010] flex gap-1 h-[244px] items-center justify-center px-8 py-12 rounded-[24px] w-full">
                  <Image
                    src="/step-2.png"
                    alt="Дождитесь обработки"
                    width={381}
                    height={244}
                    className="object-contain h-full"
                  />
                </div>
                <div className="flex flex-col gap-5 w-full">
                  <div className="flex flex-col gap-2 w-full">
                    <p className="font-medium text-[12px] leading-5 text-[#656565] uppercase">
                      Шаг 2
                    </p>
                    <div className="flex gap-2 items-center w-full">
                      <p className="font-semibold text-[16px] leading-[1.2] text-white whitespace-nowrap">
                        Дождитесь обработки
                      </p>
                    </div>
                    <div className="flex flex-col font-medium text-[14px] text-[#909090] w-full">
                      <p className="leading-5">Наша система анализирует видео, распознает сцены, действия, объекты и создает детальное описание каждого кадра. Процесс полностью автоматизирован.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 - Скачайте лист */}
            <div className="flex-1">
              <div className="bg-[#191919] flex flex-col gap-6 h-full items-center justify-center p-8 rounded-[44px]">
                <div className="bg-[#101010] flex gap-4 h-[244px] items-center justify-center px-8 py-12 rounded-[24px] w-full">
                  <Image
                    src="/step-3.png"
                    alt="Скачайте лист"
                    width={381}
                    height={244}
                    className="object-contain h-full"
                  />
                </div>
                <div className="flex flex-col gap-5 w-full">
                  <div className="flex flex-col gap-2 w-full">
                    <p className="font-medium text-[12px] leading-5 text-[#656565] uppercase">
                      Шаг 3
                    </p>
                    <div className="flex gap-2 items-center w-full">
                      <p className="font-semibold text-[16px] leading-[1.2] text-white whitespace-nowrap">
                        Скачайте лист
                      </p>
                    </div>
                    <div className="flex flex-col font-medium text-[14px] text-[#909090] w-full">
                      <p className="leading-5">Готовый монтажный лист автоматически формируется с тайм-кодами, описаниями кадров, типами планов и другими важными деталями. Вы можете экспортировать его в удобных форматах.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && user && (
        <UploadModalLong
          onClose={() => setShowUploadModal(false)}
          onUploadComplete={handleUploadComplete}
          userId={user.id}
          filmMetadata={filmMetadata}
        />
      )}
    </div>
  );
}
