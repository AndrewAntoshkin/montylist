'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpDownIcon } from '@heroicons/react/16/solid';
import type { Video, MontageSheet, MontageEntry, Profile } from '@/types';
import type { User } from '@supabase/supabase-js';
import Header from './Header';

interface MontageTableClientProps {
  video: Video;
  sheet: MontageSheet;
  entries: MontageEntry[];
  user: User;
  profile: Profile | null;
}

export default function MontageTableClient({
  video,
  sheet,
  entries,
  user,
  profile,
}: MontageTableClientProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const toggleAll = () => {
    if (expandedRows.size === entries.length) {
      // Все развернуты - сворачиваем все
      setExpandedRows(new Set());
    } else {
      // Не все развернуты - разворачиваем все
      setExpandedRows(new Set(entries.map((e) => e.id)));
    }
  };

  const handleDownloadExcel = async () => {
    setDownloading(true);
    setShowExportMenu(false);
    try {
      const response = await fetch(`/api/export/${video.id}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `montage_${video.id.substring(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading Excel:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadDoc = async () => {
    setDownloading(true);
    setShowExportMenu(false);
    try {
      const response = await fetch(`/api/export-doc/${video.id}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `montage_${video.id.substring(0, 8)}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading DOC:', error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#191919]">
      {/* Header */}
      <Header user={user} profile={profile} />

      {/* Main Content */}
      <main className="pt-[62px] flex-1 bg-[#101010]">
        <div className="max-w-[1400px] mx-auto px-8 py-6">
          {/* Top Section */}
          <div className="flex flex-col gap-4 mb-4">
            {/* Back Button */}
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 flex flex-col gap-1 items-start justify-center">
                <div className="flex gap-2 items-center w-full">
                  <Link
                    href="/dashboard"
                    className="bg-[#222222] px-1.5 pr-2.5 py-1 rounded-md flex gap-2 items-center hover:bg-[#2a2a2a] transition-colors"
                  >
                    <ArrowLeftIcon className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium leading-[1.2] tracking-[-0.3962px]">
                      Назад
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Title and Download Button */}
            <div className="flex items-start justify-between w-full gap-4">
              <h1 
                className="text-white text-base font-medium leading-7 flex-1 truncate" 
                title={video.original_filename}
              >
                {video.original_filename || 'Название фильма'}
              </h1>
              
              {/* Download Dropdown */}
              <div className="relative shrink-0" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={downloading}
                  className="h-10 px-4 py-2.5 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                    {downloading ? 'Скачивание...' : 'Скачать'}
                  </span>
                  <svg 
                    className={`w-4 h-4 text-black transition-transform ${showExportMenu ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                {showExportMenu && !downloading && (
                  <div className="absolute right-0 mt-2 w-48 bg-[#2a2a2a] rounded-lg shadow-lg border border-[#3e3e3e] overflow-hidden z-10">
                    <button
                      onClick={handleDownloadExcel}
                      className="w-full px-4 py-3 text-left text-white text-sm hover:bg-[#3e3e3e] transition-colors"
                    >
                      Сохранить в Excel
                    </button>
                    <button
                      onClick={handleDownloadDoc}
                      className="w-full px-4 py-3 text-left text-white text-sm hover:bg-[#3e3e3e] transition-colors border-t border-[#3e3e3e]"
                    >
                      Сохранить в Word
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex gap-14 items-start justify-center w-full">
            <div className="flex-1 flex flex-col gap-px overflow-hidden pb-px">
              {/* Table Header */}
              <div className="flex items-center w-full">
                <div className="bg-[#191919] h-14 w-[80px] px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal">
                    № плана
                  </span>
                </div>
                <div className="bg-[#191919] h-14 w-24 px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal whitespace-pre-line">
                    {'Начальный\nтаймкод'}
                  </span>
                </div>
                <div className="bg-[#191919] h-14 w-24 px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal whitespace-pre-line">
                    {'Конечный\nтаймкод'}
                  </span>
                </div>
                <div className="bg-[#191919] h-14 w-[80px] px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal">
                    План
                  </span>
                </div>
                <div className="bg-[#191919] h-14 flex-1 px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal">
                    Монологи, разговоры, песни, субтитры, музыка
                  </span>
                </div>
                <div className="bg-[#191919] h-14 flex-1 px-4 py-[22px] flex gap-2.5 items-center">
                  <span className="text-[#979797] text-sm font-medium leading-normal">
                    Содержание (описание) плана, титры
                  </span>
                </div>
                <div className="bg-[#191919] h-14 px-4 py-[22px] flex gap-2.5 items-center">
                  <button
                    onClick={toggleAll}
                    className="w-6 h-6 p-1 rounded-md bg-transparent hover:bg-[#2a2a2a] transition-colors flex items-center justify-center"
                    title={expandedRows.size === entries.length ? 'Свернуть все' : 'Развернуть все'}
                  >
                    <ChevronUpDownIcon className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>

              {/* Table Body */}
              <div className="flex flex-col gap-px w-full">
                {entries.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id);
                  const hasLongDialogues = (entry.dialogues?.length || 0) > 60;
                  const hasLongDescription = (entry.description?.length || 0) > 60;
                  const hasLongContent = hasLongDialogues || hasLongDescription;

                  return (
                    <div
                      key={entry.id}
                      className="flex items-center w-full border-b border-[#2c2c2c]"
                    >
                      {/* № плана */}
                      <div className="bg-[#101010] w-[80px] px-4 py-4 flex gap-2.5 items-center">
                        <span className="text-white text-sm font-medium leading-normal">
                          {entry.plan_number}
                        </span>
                      </div>

                      {/* Начальный таймкод */}
                      <div className="bg-[#101010] w-24 px-4 py-4 flex gap-2.5 items-center">
                        <span className="text-white text-sm font-normal leading-normal">
                          {entry.start_timecode}
                        </span>
                      </div>

                      {/* Конечный таймкод */}
                      <div className="bg-[#101010] w-24 px-4 py-4 flex gap-2.5 items-center">
                        <span className="text-white text-sm font-normal leading-normal">
                          {entry.end_timecode}
                        </span>
                      </div>

                      {/* План */}
                      <div className="bg-[#101010] w-[80px] px-4 py-4 flex gap-2.5 items-center">
                        <span className="text-white text-sm font-normal leading-normal">
                          {entry.plan_type || '—'}
                        </span>
                      </div>

                      {/* Монологи, диалоги */}
                      <div className="bg-[#101010] flex-1 px-4 py-4 flex gap-2.5 items-start">
                        <div className={`text-white text-sm font-normal leading-normal w-full ${isExpanded ? '' : 'line-clamp-1'}`}>
                          {entry.dialogues || '—'}
                        </div>
                      </div>

                      {/* Содержание */}
                      <div className="bg-[#101010] flex-1 px-4 py-4 flex gap-2.5 items-start">
                        <div className={`text-white text-sm font-normal leading-normal w-full ${isExpanded ? '' : 'line-clamp-1'}`}>
                          {entry.description || '—'}
                        </div>
                      </div>

                      {/* Expand/Collapse Button */}
                      <div className="bg-[#101010] px-4 py-4 flex gap-2.5 items-center justify-center">
                        {hasLongContent ? (
                          <button
                            onClick={() => toggleRow(entry.id)}
                            className="w-6 h-6 p-1 rounded-md bg-transparent hover:bg-[#2a2a2a] transition-colors flex items-center justify-center"
                            title={isExpanded ? 'Свернуть' : 'Развернуть'}
                          >
                            <ChevronDownIcon 
                              className={`w-4 h-4 text-white transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        ) : (
                          <div className="w-6 h-6" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Empty State */}
          {entries.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-400">Нет данных для отображения</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

