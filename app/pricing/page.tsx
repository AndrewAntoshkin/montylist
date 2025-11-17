import Header from '@/components/Header';
import { createClient } from '@/lib/supabase/server';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Планы и цены - Carête Montage',
  description: 'Выберите план, подходящий под ваши запросы и приступайте к работе с монтажными листами',
};

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let profile = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  return (
    <div className="bg-[#191919] flex-1 flex flex-col">
      <Header user={user || undefined} profile={profile} />
      
      {/* Main Content */}
      <div className="bg-[#101010] flex-1 box-border px-8 py-6 pt-[86px]">
        <div className="max-w-[1400px] mx-auto">
          {/* Header Section */}
          <div className="flex flex-col items-center justify-center overflow-clip pt-16 pb-14 gap-12">
            <div className="flex flex-col items-center gap-5 text-center w-[842px]">
              <h1 className="font-jost font-medium text-[56px] leading-[67.2px] text-white w-full">
                Монтажные листы за минуты
              </h1>
              <p className="font-[var(--font-inter)] font-medium not-italic text-[18px] leading-[21.6px] text-[#727272] w-full">
                Формируйте монтажные листы для любых видео
              </p>
            </div>
          </div>

          {/* Pricing Table */}
          <div className="flex rounded overflow-clip">
            {/* Column 1 - Labels */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Header Cell */}
              <div className="border-b border-[#414141] box-border h-[222px] pr-6 py-7 flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <h2 className="font-jost font-bold text-[24px] leading-[normal] text-white">
                    Сравнение планов
                  </h2>
                </div>
                <p className="font-jost font-normal text-[16px] leading-[24px] text-[#a9a9a9]">
                  Выберите план, подходящий под ваши запросы и приступайте к работе
                </p>
              </div>

              {/* Row 1 - Количество минут */}
              <div className="border-b border-[#414141] box-border h-[80px] py-5 flex items-center gap-2.5">
                <p className="font-jost font-normal text-[16px] leading-[26px] text-white flex-1">
                  Количество минут
                </p>
              </div>

              {/* Row 2 - Стоимость минуты */}
              <div className="border-b border-[#414141] box-border h-[80px] py-5 flex items-center gap-2.5">
                <p className="font-jost font-normal text-[16px] leading-[26px] text-white flex-1">
                  Стоимость минуты
                </p>
              </div>

              {/* Row 3 - Количество видео */}
              <div className="border-b border-[#414141] box-border h-[80px] py-5 flex items-center gap-2.5">
                <p className="font-jost font-normal text-[16px] leading-[26px] text-white flex-1">
                  Количество видео
                </p>
              </div>

              {/* Row 4 - Техническая поддержка */}
              <div className="border-b border-[#414141] box-border h-[80px] py-5 flex items-center gap-2.5">
                <p className="font-jost font-normal text-[16px] leading-[26px] text-white flex-1">
                  Техническая поддержка
                </p>
              </div>

              {/* Row 5 - Приоритет обработки */}
              <div className="border-b border-[#414141] box-border h-[80px] py-5 flex items-center gap-2.5">
                <p className="font-jost font-normal text-[16px] leading-[26px] text-white flex-1">
                  Приоритет обработки
                </p>
              </div>
            </div>

            {/* Column 2 - Free Plan */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
              {/* Header */}
              <div className="border-b border-[#414141] box-border h-[222px] px-6 py-7 flex flex-col items-center justify-between w-full">
                <div className="flex flex-col gap-2 items-start w-full">
                  <h3 className="font-jost font-bold text-[20px] leading-[normal] text-white w-min">
                    Free
                  </h3>
                  <div className="flex items-center gap-2 w-full">
                    <p className="font-jost font-semibold text-[28px] leading-[33.6px] text-white whitespace-pre">
                      0₽
                    </p>
                  </div>
                  <p className="font-jost font-normal text-[14px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                    доступно только 1 видео
                  </p>
                </div>
                <button className="bg-white box-border flex items-center justify-center px-6 py-3 rounded-lg w-full">
                  <span className="font-jost font-semibold text-[14px] leading-[20px] text-black text-center flex-1">
                    ПОПРОБОВАТЬ
                  </span>
                </button>
              </div>

              {/* Row 1 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  до 30 минут
                </p>
              </div>

              {/* Row 2 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  Бесплатно
                </p>
                <p className="font-jost font-normal text-[16px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                  доступно только 1 раз
                </p>
              </div>

              {/* Row 3 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  Одно видео
                </p>
              </div>

              {/* Row 4 */}
              <div className="border-b border-[#414141] h-[80px] w-full" />

              {/* Row 5 */}
              <div className="border-b border-[#414141] h-[80px] w-full" />
            </div>

            {/* Column 3 - Start Plan */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
              {/* Header */}
              <div className="border-b border-[#414141] box-border h-[222px] px-6 py-7 flex flex-col items-center justify-between w-full">
                <div className="flex flex-col gap-2 items-start w-full">
                  <h3 className="font-jost font-bold text-[20px] leading-[normal] text-white w-min">
                    Start
                  </h3>
                  <div className="flex items-center gap-2 w-full">
                    <p className="font-jost font-semibold text-[28px] leading-[33.6px] text-white whitespace-pre">
                      27,000 ₽
                    </p>
                    <div className="bg-[#157812] box-border flex items-center gap-1.5 px-2.5 py-1 rounded-[200px]">
                      <span className="font-jost font-semibold text-[14px] leading-[19.6px] text-white tracking-[0.14px] whitespace-pre">
                        -10%
                      </span>
                    </div>
                  </div>
                  <p className="font-jost font-normal text-[14px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                    вместо 30,000₽
                  </p>
                </div>
                <button className="bg-white box-border flex items-center justify-center px-6 py-3 rounded-lg w-full">
                  <span className="font-jost font-semibold text-[14px] leading-[20px] text-black text-center flex-1">
                    КУПИТЬ
                  </span>
                </button>
              </div>

              {/* Row 1 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  300 минут
                </p>
              </div>

              {/* Row 2 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  90₽ / мин
                </p>
                <p className="font-jost font-normal text-[16px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                  Скидка 10%
                </p>
              </div>

              {/* Row 3 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  3-4 фильма
                </p>
              </div>

              {/* Row 4 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex items-center gap-1 w-full">
                <Image 
                  src="/icons/check-circle-filled.svg" 
                  alt="Check" 
                  width={20} 
                  height={20}
                  className="shrink-0"
                />
              </div>

              {/* Row 5 */}
              <div className="border-b border-[#414141] h-[80px] w-full" />
            </div>

            {/* Column 4 - Studio Plan */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
              {/* Header */}
              <div className="border-b border-[#414141] box-border h-[222px] px-6 py-7 flex flex-col items-center justify-between w-full">
                <div className="flex flex-col gap-2 items-start w-full">
                  <h3 className="font-jost font-bold text-[20px] leading-[normal] text-white w-min">
                    Studio
                  </h3>
                  <div className="flex items-center gap-2 w-full">
                    <p className="font-jost font-semibold text-[28px] leading-[33.6px] text-white whitespace-pre">
                      70,000 ₽
                    </p>
                    <div className="bg-[#157812] box-border flex items-center gap-1.5 px-2.5 py-1 rounded-[200px]">
                      <span className="font-jost font-semibold text-[14px] leading-[19.6px] text-white tracking-[0.14px] whitespace-pre">
                        -30%
                      </span>
                    </div>
                  </div>
                  <p className="font-jost font-normal text-[14px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                    вместо 100,000₽
                  </p>
                </div>
                <button className="bg-white box-border flex items-center justify-center px-6 py-3 rounded-lg w-full">
                  <span className="font-jost font-semibold text-[14px] leading-[20px] text-black text-center flex-1">
                    КУПИТЬ
                  </span>
                </button>
              </div>

              {/* Row 1 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  1,000 минут
                </p>
              </div>

              {/* Row 2 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  70₽ / мин
                </p>
                <p className="font-jost font-normal text-[16px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                  Скидка 30%
                </p>
              </div>

              {/* Row 3 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  10-15 фильмов
                </p>
              </div>

              {/* Row 4 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex items-center gap-1 w-full">
                <Image 
                  src="/icons/check-circle-filled.svg" 
                  alt="Check" 
                  width={20} 
                  height={20}
                  className="shrink-0"
                />
              </div>

              {/* Row 5 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex items-center gap-1 w-full">
                <Image 
                  src="/icons/check-circle-filled.svg" 
                  alt="Check" 
                  width={20} 
                  height={20}
                  className="shrink-0"
                />
              </div>
            </div>

            {/* Column 5 - Enterprise Plan */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
              {/* Header */}
              <div className="border-b border-[#414141] box-border h-[222px] px-6 py-7 flex flex-col items-center justify-between w-full">
                <div className="flex flex-col gap-2 items-start leading-[0] w-full">
                  <h3 className="font-jost font-bold text-[20px] leading-[normal] text-white w-min">
                    Enterprise
                  </h3>
                  <p className="font-jost font-medium text-[14px] leading-[20px] text-white w-min">
                    Стоимость зависит от количества минут
                  </p>
                  <p className="font-jost font-normal text-[14px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                    Прогрессивная скидка до 50%
                  </p>
                </div>
                <button className="bg-white box-border flex items-center justify-center px-6 py-3 rounded-lg w-full">
                  <span className="font-jost font-semibold text-[14px] leading-[20px] text-black text-center flex-1">
                    РАССЧИТАТЬ
                  </span>
                </button>
              </div>

              {/* Row 1 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  Зависит от количества минут
                </p>
              </div>

              {/* Row 2 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  Зависит от количества минут
                </p>
                <p className="font-jost font-normal text-[16px] leading-[20px] text-[#a9a9a9] whitespace-pre">
                  Прогрессивная скидка до 50%
                </p>
              </div>

              {/* Row 3 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex flex-col gap-1 justify-center w-full">
                <p className="font-jost font-normal text-[16px] leading-[20px] text-white whitespace-pre">
                  Гибкий объем
                </p>
              </div>

              {/* Row 4 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex items-center gap-1 w-full">
                <Image 
                  src="/icons/check-circle-filled.svg" 
                  alt="Check" 
                  width={20} 
                  height={20}
                  className="shrink-0"
                />
              </div>

              {/* Row 5 */}
              <div className="border-b border-[#414141] box-border h-[80px] px-6 py-4 flex items-center gap-1 w-full">
                <Image 
                  src="/icons/check-circle-filled.svg" 
                  alt="Check" 
                  width={20} 
                  height={20}
                  className="shrink-0"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
