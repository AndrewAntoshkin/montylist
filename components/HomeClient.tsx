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
          <div className="border border-[#639E59] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-[10px] font-medium text-white uppercase leading-none tracking-wide">
              Загружен
            </span>
          </div>
        );
      case 'processing':
      case 'uploading':
        return (
          <div className="border border-[#B8860B] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-[10px] font-medium text-white uppercase leading-none tracking-wide">
              {status === 'uploading' ? 'Загрузка' : 'Обработка'}
            </span>
          </div>
        );
      case 'error':
        return (
          <div className="border border-[#B22222] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-[10px] font-medium text-white uppercase leading-none tracking-wide">
              Ошибка
            </span>
          </div>
        );
      default:
        return (
          <div className="border border-[#639E59] px-2.5 py-1 rounded-lg h-6 flex items-center justify-center">
            <span className="text-[10px] font-medium text-white uppercase leading-none tracking-wide">
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
      <div className="max-w-[1400px] mx-auto px-8 flex flex-col gap-10">
        
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-12 py-[120px] max-w-[878px] mx-auto w-full">
          {/* Hero Head */}
          <div className="flex flex-col items-center gap-7 w-full">
            {/* Logo Icon + Title */}
            <div className="flex flex-col items-center gap-2">
              {/* Monty Logo Icon */}
              <div className="pt-[1.85px]">
                <Image 
                  src="/monty-logo.svg" 
                  alt="Monty" 
                  width={76} 
                  height={21}
                  className="text-white"
                />
              </div>
              
              {/* Main Heading */}
              <h1 className="text-[64px] font-medium leading-[1.15625] tracking-[-0.01em] text-center text-white max-w-[675px]">
                Создавайте монтажные листы
                <br />
                за минуты
              </h1>
            </div>
            
            {/* Subtitle */}
            <p className="text-base font-normal leading-7 tracking-[-0.018em] text-center text-white/60 max-w-[736px]">
              Загрузите видео и сценарий — искусственный интеллект автоматически создаст подробный монтажный лист с таймкодами, описанием сцен и типами планов. Экономьте часы работы и получайте профессиональный результат за считанные минуты.
            </p>
          </div>

          {/* CTA Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-[#F5F5F5] hover:bg-white px-4 py-2.5 rounded-lg h-[42px] flex items-center justify-center transition-colors"
            >
              <span className="text-sm font-medium text-black tracking-[-0.03em]">
                Создать новый лист
              </span>
            </button>
          </div>
        </div>

        {/* Recent Files Section */}
        {recentVideos && recentVideos.length > 0 && (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="flex flex-col gap-2 w-full">
              <p className="text-xs font-medium leading-5 text-[#656565] uppercase">
                Недавние файлы
              </p>
              
              {/* Grid with videos - 4 columns */}
              <div className="flex flex-col gap-8">
                {/* Row 1 */}
                <div className="flex flex-col gap-5">
                  <div className="grid grid-cols-4 gap-5 w-full">
                    {recentVideos.slice(0, 4).map((video) => renderVideoCard(video))}
                  </div>
                  
                  {/* Row 2 */}
                  {recentVideos.length > 4 && (
                    <div className="grid grid-cols-4 gap-5 w-full">
                      {recentVideos.slice(4, 8).map((video) => renderVideoCard(video))}
                    </div>
                  )}
                </div>
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
        <div className="flex flex-col gap-8 items-center py-16 w-full">
          <h2 className="font-semibold text-[32px] leading-[1.2] text-center text-white w-full">
            Как это работает?
          </h2>
          
          <div className="grid grid-cols-3 gap-6 w-full">
            {/* Step 1 - Загрузите сценарий и видео */}
            <div className="flex flex-col">
              {/* Image Area */}
              <div className="bg-[#181818] rounded-t-[24px] flex items-center justify-center px-8 py-12 gap-4 h-[216px]">
                <Image
                  src="/file-doc.svg"
                  alt="DOC файл"
                  width={90}
                  height={120}
                  className="object-contain"
                />
                <Image
                  src="/file-video.svg"
                  alt="Video файл"
                  width={90}
                  height={120}
                  className="object-contain"
                />
              </div>
              
              {/* Text Content */}
              <div className="flex flex-col gap-5 p-4">
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-xs leading-5 text-[#656565] uppercase">
                    Шаг 1
                  </p>
                  <p className="font-semibold text-xl leading-[1.2] text-white">
                    Загрузите сценарий и видео
                  </p>
                  <p className="font-medium text-sm leading-5 text-[#BDBDBD]">
                    Просто перетащите ваш видеофайл в окно загрузки или выберите файл на компьютере. Поддерживаются все популярные форматы: MP4, MOV, AVI и другие.
                  </p>
                  <div className="flex flex-col gap-1 mt-2">
                    <p className="text-xs leading-[1.17] text-[#626262]">
                      Формат для сценария .DOC, DOCX
                    </p>
                    <p className="text-xs leading-[1.17] text-[#626262]">
                      Максимальный размер видео 500mb
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 - Дождитесь обработки */}
            <div className="flex flex-col">
              {/* Image Area */}
              <div className="bg-[#181818] rounded-t-[24px] flex items-center justify-center px-8 py-12 gap-2 h-[216px]">
                {/* Processing animation mockup */}
                <div className="relative w-[120px] h-[129px]">
                  <div className="absolute inset-0 bg-[#2E2E2E] rounded-xl"></div>
                  <div className="absolute left-[10px] top-[12px] right-[10px] h-[69px] bg-[#101010] rounded-lg"></div>
                  <div className="absolute left-[24px] top-[24px] w-[72px] h-[45px] rounded overflow-hidden flex">
                    <div className="w-1/2 h-full bg-gradient-to-r from-[#7796E9] to-[#7796E9]/50"></div>
                    <div className="w-1/2 h-full bg-white/20"></div>
                  </div>
                  <div className="absolute left-[58px] top-[20px] w-1 h-[53px] bg-[#7796E9] rounded-sm shadow-[0_0_4px_rgba(0,0,0,1)]"></div>
                  <p className="absolute left-[12px] bottom-[16px] text-xs font-semibold text-white">Movie.mp4</p>
                </div>
                
                {/* Arrow dots */}
                <div className="flex items-center gap-0.5 mx-2">
                  <div className="w-6 h-0.5 bg-gradient-to-r from-transparent to-[#7796E9]"></div>
                </div>
                
                {/* Document result */}
                <div className="relative w-[120px] h-[129px]">
                  <div className="absolute inset-0 bg-[#2E2E2E] rounded-xl"></div>
                  <p className="absolute left-[12px] top-[12px] text-xs font-semibold text-white">Лист</p>
                  <div className="absolute left-[12px] top-[33px] right-[12px] flex flex-col gap-[6px]">
                    <div className="h-2 bg-[#4E4D4D] rounded-sm"></div>
                    <div className="h-2 bg-[#4E4D4D] rounded-sm"></div>
                    <div className="h-2 bg-[#4E4D4D] rounded-sm"></div>
                    <div className="h-2 bg-[#4E4D4D] rounded-sm"></div>
                    <div className="h-2 bg-[#4E4D4D] rounded-sm"></div>
                    <div className="h-2 w-[56px] bg-[#4E4D4D] rounded-sm"></div>
                  </div>
                </div>
              </div>
              
              {/* Text Content */}
              <div className="flex flex-col gap-5 p-4">
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-xs leading-5 text-[#656565] uppercase">
                    Шаг 2
                  </p>
                  <p className="font-semibold text-xl leading-[1.2] text-white">
                    Дождитесь обработки
                  </p>
                  <p className="font-medium text-sm leading-5 text-[#BDBDBD]">
                    Наша система анализирует видео, распознает сцены, действия, объекты и создает детальное описание каждого кадра. Процесс полностью автоматизирован.
                  </p>
                  <div className="flex flex-col gap-1 mt-2">
                    <p className="text-xs leading-[1.17] text-[#626262]">
                      В среднем обработка занимает около 30-40 минут
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 - Скачайте лист */}
            <div className="flex flex-col">
              {/* Image Area */}
              <div className="bg-[#181818] rounded-t-[24px] flex items-center justify-center px-8 py-12 gap-4 h-[216px]">
                <div className="relative">
                  <Image
                    src="/file-doc-glow.svg"
                    alt="DOC файл"
                    width={90}
                    height={120}
                    className="object-contain drop-shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
                  />
                </div>
                
                <Image
                  src="/switch-horizontal.svg"
                  alt="Switch"
                  width={24}
                  height={24}
                  className="text-white"
                />
                
                <Image
                  src="/file-xls.svg"
                  alt="XLS файл"
                  width={90}
                  height={120}
                  className="object-contain"
                />
              </div>
              
              {/* Text Content */}
              <div className="flex flex-col gap-5 p-4">
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-xs leading-5 text-[#656565] uppercase">
                    Шаг 3
                  </p>
                  <p className="font-semibold text-xl leading-[1.2] text-white">
                    Скачайте лист
                  </p>
                  <p className="font-medium text-sm leading-5 text-[#BDBDBD]">
                    Готовый монтажный лист автоматически формируется с тайм-кодами, описаниями кадров, типами планов и другими важными деталями. Вы можете экспортировать его в удобных форматах.
                  </p>
                  <div className="flex flex-col gap-1 mt-2">
                    <p className="text-xs leading-[1.17] text-[#626262]">
                      На выходе получите файл готовый по ГОСТУ для Архива кино
                    </p>
                    <p className="text-xs leading-[1.17] text-[#626262]">
                      Доступные форматы для скачивания .DOCX, .XLS
                    </p>
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
