'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { FilmMetadata } from '@/types';

interface FilmDetailsModalProps {
  onClose: () => void;
  onContinue: (metadata: FilmMetadata) => void;
  onSkip: () => void;
}

export default function FilmDetailsModal({
  onClose,
  onContinue,
  onSkip,
}: FilmDetailsModalProps) {
  const [formData, setFormData] = useState<FilmMetadata>({
    producer_company: '',
    release_year: '',
    country: '',
    screenwriter: '',
    director: '',
    copyright_holder: '',
    duration_text: '',
    episodes_count: '',
    frame_format: '',
    color_format: '',
    media_carrier: '',
    original_language: 'Русский',
    subtitles_language: 'Русский',
    audio_language: 'Русский',
  });

  const handleChange = (field: keyof FilmMetadata, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleContinue = () => {
    onContinue(formData);
  };

  return (
    <>
      {/* Затемненный фон */}
      <div
        className="fixed inset-0 bg-black/80 z-50"
        onClick={onClose}
      />

      {/* Модальное окно */}
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="relative flex gap-4 items-start pointer-events-auto">
          {/* Modal */}
          <div className="bg-[#191919] rounded-[24px] w-[664px] border border-[#2e2e2e]">
            <div className="flex flex-col w-full overflow-hidden rounded-[inherit]">
              {/* Header */}
              <div className="bg-[#191919] flex gap-3 items-center px-8 pt-6 pb-4">
                <h2 className="text-white text-lg font-medium leading-none tracking-[-0.3962px]">
                  Новый лист
                </h2>
              </div>

              {/* Content - Scrollable */}
              <div className="flex flex-col gap-4 px-8 py-0 max-h-[calc(100vh-200px)] overflow-y-auto">
                <div className="flex flex-col gap-4 items-center justify-center w-full">
                  <div className="flex flex-col gap-4 items-start justify-end w-full">
                    {/* Title */}
                    <div className="flex flex-col gap-2 items-start w-full">
                      <h3 className="text-white text-2xl leading-[1.2] tracking-[-0.3962px] w-full">
                        Данные фильма
                      </h3>
                    </div>

                    {/* Фирма-производитель */}
                    <div className="flex flex-col items-start w-full">
                      <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                        Фирма-производитель
                      </label>
                      <input
                        type="text"
                        value={formData.producer_company}
                        onChange={(e) => handleChange('producer_company', e.target.value)}
                        placeholder="Эко-ботинки TerraWalk"
                        className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>

                    {/* Год выпуска и Страна производства */}
                    <div className="flex gap-3 items-start w-full">
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Год выпуска
                        </label>
                        <input
                          type="text"
                          value={formData.release_year}
                          onChange={(e) => handleChange('release_year', e.target.value)}
                          placeholder="2024"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Страна производства
                        </label>
                        <input
                          type="text"
                          value={formData.country}
                          onChange={(e) => handleChange('country', e.target.value)}
                          placeholder="Россия"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                    </div>

                    {/* Автор (ы) сценария */}
                    <div className="flex flex-col items-start w-full">
                      <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                        Автор (ы) сценария
                      </label>
                      <input
                        type="text"
                        value={formData.screenwriter}
                        onChange={(e) => handleChange('screenwriter', e.target.value)}
                        placeholder="Закажи сейчас на сайте"
                        className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>

                    {/* Режиссер-постановщик */}
                    <div className="flex flex-col items-start w-full">
                      <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                        Режиссер-постановщик
                      </label>
                      <input
                        type="text"
                        value={formData.director}
                        onChange={(e) => handleChange('director', e.target.value)}
                        placeholder="Закажи сейчас на сайте"
                        className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>

                    {/* Правообладатель (и) */}
                    <div className="flex flex-col items-start w-full">
                      <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                        Правообладатель (и)
                      </label>
                      <input
                        type="text"
                        value={formData.copyright_holder}
                        onChange={(e) => handleChange('copyright_holder', e.target.value)}
                        placeholder="Современный мегаполис, юридический инкубатор"
                        className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>

                    {/* Продолжительность фильма и Количество серий */}
                    <div className="flex gap-4 items-start w-full">
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Продолжительность фильма
                        </label>
                        <input
                          type="text"
                          value={formData.duration_text}
                          onChange={(e) => handleChange('duration_text', e.target.value)}
                          placeholder="90 минут"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Количество серий
                        </label>
                        <input
                          type="text"
                          value={formData.episodes_count}
                          onChange={(e) => handleChange('episodes_count', e.target.value)}
                          placeholder="1"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                    </div>

                    {/* Формат кадра и Цветной / черно-белый */}
                    <div className="flex gap-4 items-start w-full">
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Формат кадра
                        </label>
                        <input
                          type="text"
                          value={formData.frame_format}
                          onChange={(e) => handleChange('frame_format', e.target.value)}
                          placeholder="16:9"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Цветной / черно-белый
                        </label>
                        <input
                          type="text"
                          value={formData.color_format}
                          onChange={(e) => handleChange('color_format', e.target.value)}
                          placeholder="Цветной"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                    </div>

                    {/* Носитель информации */}
                    <div className="flex flex-col items-start w-full">
                      <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                        Носитель информации
                      </label>
                      <input
                        type="text"
                        value={formData.media_carrier}
                        onChange={(e) => handleChange('media_carrier', e.target.value)}
                        placeholder="Цифровой"
                        className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                      />
                    </div>

                    {/* Язык оригинала, Язык надписей, Язык фонограммы */}
                    <div className="flex gap-4 items-start w-full">
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Язык оригинала
                        </label>
                        <input
                          type="text"
                          value={formData.original_language}
                          onChange={(e) => handleChange('original_language', e.target.value)}
                          placeholder="Русский"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Язык надписей
                        </label>
                        <input
                          type="text"
                          value={formData.subtitles_language}
                          onChange={(e) => handleChange('subtitles_language', e.target.value)}
                          placeholder="Русский"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                      <div className="flex-1 flex flex-col items-start">
                        <label className="pb-2 text-[#a4a4a4] text-sm leading-[1.2] tracking-[-0.3962px]">
                          Язык фонограммы
                        </label>
                        <input
                          type="text"
                          value={formData.audio_language}
                          onChange={(e) => handleChange('audio_language', e.target.value)}
                          placeholder="Русский"
                          className="bg-neutral-800 w-full h-10 px-3 py-2.5 rounded-xl text-white/51 text-sm leading-[18px] outline-none focus:ring-1 focus:ring-white/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-[#191919] flex gap-3 items-center justify-end px-8 py-4">
                <button
                  onClick={onClose}
                  className="h-[42px] px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#252525] transition-colors"
                >
                  <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                    Отмена
                  </span>
                </button>
                <button
                  onClick={onSkip}
                  className="h-[42px] px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#252525] transition-colors"
                >
                  <span className="text-white text-sm font-medium leading-none tracking-[-0.3962px]">
                    Пропустить
                  </span>
                </button>
                <button
                  onClick={handleContinue}
                  className="h-[42px] px-4 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  <span className="text-black text-sm font-medium leading-none tracking-[-0.3962px]">
                    Продолжить
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="w-8 h-8 bg-white rounded-[10px] flex items-center justify-center hover:bg-neutral-200 transition-colors shrink-0"
          >
            <Image src="/icons/close-icon.svg" alt="Close" width={16} height={16} />
          </button>
        </div>
      </div>
    </>
  );
}

