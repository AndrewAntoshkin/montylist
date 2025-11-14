'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TrashIcon } from '@heroicons/react/16/solid';
import Image from 'next/image';
import type { Video } from '@/types';
import GradientBorder from './GradientBorder';

interface VideoCardProps {
  video: Video;
}

export default function VideoCard({ video }: VideoCardProps) {
  const router = useRouter();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getStatusBadge = () => {
    switch (video.status) {
      case 'completed':
        return (
          <div className="h-6 px-2.5 py-1 bg-[#4d6a2f] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-medium leading-normal">
              Загружен
            </span>
          </div>
        );
      case 'processing':
        return (
          <div className="h-6 px-2.5 py-1 bg-[#3e3e3e] rounded-lg flex items-center justify-center">
            <span className="text-[#7e7e7e] text-xs font-medium leading-normal">
              В обработке
            </span>
          </div>
        );
      case 'uploading':
        return (
          <div className="h-6 px-2.5 py-1 bg-[#2a2a2a] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-medium leading-normal">
              Загрузка...
            </span>
          </div>
        );
      case 'error':
        return (
          <div className="h-6 px-2.5 py-1 bg-red-500/20 rounded-lg flex items-center justify-center">
            <span className="text-red-400 text-xs font-medium leading-normal">
              Ошибка
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Вы уверены, что хотите удалить этот монтажный лист?')) {
      return;
    }

    try {
      const response = await fetch(`/api/videos/${video.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.refresh();
      }
    } catch (error) {
      console.error('Error deleting video:', error);
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const response = await fetch(`/api/export/${video.id}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Безопасное имя файла
      a.download = `montage_${video.id.substring(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading:', error);
    }
  };

  const cardContent = (
    <div className="flex flex-col gap-5 w-full">
      {/* Top section: Status and Delete */}
      <div className="flex items-start justify-between w-full h-8">
        {getStatusBadge()}
        
        <button
          onClick={handleDelete}
          className="h-8 w-8 bg-transparent border-0 flex items-center justify-center hover:opacity-70 transition-opacity"
          title="Удалить"
        >
          <TrashIcon className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Bottom section: Title, Progress and Date */}
      <div className="flex flex-col gap-2 w-full">
        <h3 className="text-[#7e7e7e] text-base font-semibold leading-6 w-full truncate" title={video.original_filename || 'Название фильма'}>
          {video.original_filename || 'Название фильма'}
        </h3>
        
        {/* Chunk Progress - показываем если есть */}
        {video.chunk_progress && video.chunk_progress.totalChunks > 0 && (
          <div className="flex flex-col gap-3 w-full">
            {video.chunk_progress.chunks.map((chunk) => (
              <div key={chunk.index} className="flex gap-3 items-center">
                <div className="relative shrink-0 w-[18px] h-[18px]">
                  {chunk.status === 'completed' ? (
                    <Image
                      src="/icons/check-circle.svg"
                      alt="Completed"
                      width={18}
                      height={18}
                      className="w-full h-full"
                    />
                  ) : chunk.status === 'processing' ? (
                    <Image
                      src="/icons/spinner.svg"
                      alt="Processing"
                      width={18}
                      height={18}
                      className="w-full h-full animate-spin"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full border-2 border-[#3e3e3e]" />
                  )}
                </div>
                <p className={`text-xs font-normal leading-5 ${
                  chunk.status === 'completed' ? 'text-white' : 
                  chunk.status === 'processing' ? 'text-[#9f9f9f]' : 
                  'text-[#5e5e5e]'
                }`}>
                  Часть {chunk.index + 1}{chunk.status === 'processing' ? '...' : ''}
                </p>
              </div>
            ))}
          </div>
        )}
        
        <p className="text-[#7e7e7e] text-xs font-normal leading-5 w-full">
          {formatDate(video.created_at)}
        </p>
      </div>
    </div>
  );

  // Для видео в обработке - анимированная градиентная обводка
  const isProcessing = video.status === 'processing' || video.status === 'uploading';

  if (video.status === 'completed') {
    return (
      <Link
        href={`/dashboard/${video.id}`}
        className="block p-4 bg-[#191919] rounded-xl hover:bg-[#1f1f1f] transition-colors"
      >
        {cardContent}
      </Link>
    );
  }

  if (isProcessing) {
    return (
      <GradientBorder>
        <div className="p-4 bg-[#191919] rounded-xl">
          {cardContent}
        </div>
      </GradientBorder>
    );
  }

  return (
    <div className="p-4 bg-[#191919] rounded-xl">
      {cardContent}
    </div>
  );
}

