'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import Image from 'next/image';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/types';

interface AboutClientProps {
  user?: User;
  profile?: Profile | null;
}

// FAQ data
const faqData = [
  {
    question: 'Как долго обрабатывается видео?',
    answer: 'Время обработки зависит от длительности и качества видео. В среднем, обработка занимает от 5 до 15 минут для видео длительностью до 90 минут. Длинные видео могут обрабатываться дольше. Пользователи тарифов Studio и Enterprise получают приоритетную обработку.'
  },
  {
    question: 'В каких форматах можно экспортировать монтажные листы?',
    answer: 'Монтажные листы доступны для экспорта в форматах TXT, DOCX и PDF. Вы можете выбрать наиболее удобный формат для дальнейшей работы или передачи коллегам.'
  },
  {
    question: 'Безопасны ли мои видеофайлы?',
    answer: 'Да, безопасность данных — наш приоритет. Все видеофайлы хранятся в зашифрованном виде и доступны только вам. Мы не передаем ваши файлы третьим лицам и не используем их для каких-либо целей, кроме создания монтажных листов.'
  },
  {
    question: 'Можно ли редактировать готовый монтажный лист?',
    answer: 'После экспорта вы можете редактировать монтажный лист в любом текстовом или документальном редакторе. Мы предоставляем структурированный базовый вариант, который вы можете доработать под свои нужды.'
  },
  {
    question: 'Что делать, если результат не устраивает?',
    answer: 'Наша система постоянно совершенствуется. Если результат не соответствует вашим ожиданиям, свяжитесь с технической поддержкой. Мы рассмотрим вашу ситуацию и поможем найти решение. Для пользователей платных тарифов мы предлагаем повторную обработку при необходимости.'
  },
  {
    question: 'Есть ли ограничения по размеру файла?',
    answer: 'Максимальный размер файла зависит от вашего тарифа. Для бесплатного тарифа ограничение составляет 5 ГБ. Для платных тарифов ограничения более гибкие. Если у вас очень большие файлы, свяжитесь с нами для обсуждения индивидуальных условий.'
  },
  {
    question: 'Как работает подсчет минут в тарифных планах?',
    answer: 'Минуты считаются по длительности обработанного видео. Например, если вы загружаете 90-минутный фильм, с вашего баланса будет списано 90 минут. Неиспользованные минуты не сгорают и доступны для использования в любое время.'
  },
  {
    question: 'Работает ли сервис с видео на разных языках?',
    answer: 'Да, наш сервис анализирует визуальный контент видео, поэтому язык не имеет значения. Монтажные листы формируются на русском языке, описывая происходящее на экране независимо от языка аудиодорожки.'
  }
];

function FAQItem({ question, answer, isOpen, onToggle }: { 
  question: string; 
  answer: string; 
  isOpen: boolean; 
  onToggle: () => void;
}) {
  return (
    <div 
      className="border-b border-[#6b6b6b] flex gap-5 items-start py-4 w-full cursor-pointer"
      onClick={onToggle}
    >
      <div className="flex-1 flex flex-col gap-3">
        <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
          {question}
        </p>
        {isOpen && (
          <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
            {answer}
          </p>
        )}
      </div>
      <div className={`bg-[#252525] flex items-center p-1 rounded-md shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
        <Image 
          src="/icons/chevron-down-small.svg" 
          alt="Toggle" 
          width={16} 
          height={16}
        />
      </div>
    </div>
  );
}

export default function AboutClient({ user, profile }: AboutClientProps) {
  const [openFAQIndex, setOpenFAQIndex] = useState<number | null>(1); // Second item open by default

  return (
    <div className="flex-1">
      <Header user={user} profile={profile} />
      
      {/* Main Content */}
      <div className="flex-1 py-6">
        <div className="max-w-[880px] mx-auto px-8 pb-20">
          {/* Header Section */}
          <div className="flex flex-col gap-12 items-center justify-center overflow-clip pt-16 pb-20">
            <div className="flex flex-col gap-5 items-start w-full">
              <h1 className="font-jost font-medium text-[56px] leading-[1.2] text-white w-full">
                О сервисе Monty
              </h1>
              <p className="font-jost font-normal text-[20px] leading-[28px] text-[#999999] w-full">
                Автоматизируйте создание монтажных листов и экономьте часы рутинной работы
              </p>
            </div>
          </div>

          {/* Что такое Monty */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-5 items-start w-full">
              <h2 className="font-jost font-medium text-[24px] leading-[1.2] text-white w-full">
                Что такое Monty?
              </h2>
              <div className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3] w-full">
                <p className="mb-6">
                  Monty — это современный сервис для автоматического создания монтажных листов. Мы используем передовые технологии искусственного интеллекта для анализа видео и формирования детальных монтажных листов, которые раньше требовали часов ручной работы.
                </p>
                <p>
                  Наш сервис предназначен для режиссеров монтажа, продюсеров, архивариусов и всех специалистов кино- и видеоиндустрии, которым необходимо быстро создавать структурированную документацию по видеоматериалам.
                </p>
              </div>
            </div>
          </section>

          {/* Как это работает */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-7 items-start w-full">
              <h2 className="font-jost font-medium text-[24px] leading-[1.2] text-white w-full">
                Как это работает?
              </h2>
              <div className="flex flex-col gap-5 items-start w-full">
                {/* Step 1 */}
                <div className="flex gap-5 items-start w-full">
                  <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                    <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">1</span>
                  </div>
                  <div className="flex-1 flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Загрузите видео
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Просто перетащите ваш видеофайл в окно загрузки или выберите файл на компьютере. Поддерживаются все популярные форматы: MP4, MOV, AVI и другие.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-5 items-start w-full">
                  <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                    <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">2</span>
                  </div>
                  <div className="flex-1 flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Автоматический анализ
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Наша система анализирует видео, распознает сцены, действия, объекты и создает детальное описание каждого кадра. Процесс полностью автоматизирован.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-5 items-start w-full">
                  <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                    <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">3</span>
                  </div>
                  <div className="flex-1 flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Получите монтажный лист
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Готовый монтажный лист автоматически формируется с тайм-кодами, описаниями кадров, типами планов и другими важными деталями. Вы можете экспортировать его в удобных форматах.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Преимущества использования */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-7 items-start w-full">
              <h2 className="font-jost font-medium text-[24px] leading-[1.2] text-white w-full">
                Преимущества использования
              </h2>
              <div className="flex flex-col gap-3 items-start w-full">
                {/* Row 1 */}
                <div className="flex gap-3 items-start w-full">
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">1</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Экономия времени
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        То, что раньше занимало часы работы, теперь выполняется за минуты
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">2</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Детальные описания
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        Получайте структурированные листы с тайм-кодами и подробными описаниями
                      </p>
                    </div>
                  </div>
                </div>

                {/* Row 2 */}
                <div className="flex gap-3 items-start w-full">
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">3</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Высокая точность
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        ИИ распознает детали, которые легко упустить при ручной обработке
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">4</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Удобный экспорт
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        Экспортируйте результаты в различных форматах для дальнейшей работы
                      </p>
                    </div>
                  </div>
                </div>

                {/* Row 3 */}
                <div className="flex gap-3 items-start w-full">
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">5</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Безопасность данных
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        Ваши видео надежно защищены и доступны только вам
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 bg-[#191919] flex flex-col gap-5 p-5 rounded-xl">
                    <div className="bg-white flex items-center justify-center rounded-full shrink-0 w-7 h-7">
                      <span className="font-jost font-semibold text-[18px] leading-[24px] text-[#101010]">6</span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                        Профессиональное качество
                      </p>
                      <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                        Листы соответствуют стандартам киноиндустрии
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Как загружать видео */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-5 items-start w-full">
              <h2 className="font-jost font-medium text-[26px] leading-[1.2] text-white w-full">
                Как загружать видео
              </h2>
              
              <div className="flex flex-col gap-3 items-start w-full">
                <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                  Поддерживаемые форматы
                </p>
                <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                  MP4, MOV, AVI, MKV, WebM и другие популярные форматы видео
                </p>
              </div>

              <div className="flex flex-col gap-3 items-start w-full">
                <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                  Рекомендации по загрузке
                </p>
                <ul className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3] list-disc ml-6">
                  <li>Используйте стабильное интернет-соединение для больших файлов</li>
                  <li>Для длинных видео (более 30 минут) время обработки может увеличиться</li>
                  <li>Качество видео влияет на точность распознавания деталей</li>
                  <li>Рекомендуемое разрешение: от 720p и выше</li>
                </ul>
              </div>

              <div className="flex flex-col gap-3 items-start w-full">
                <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                  Процесс загрузки
                </p>
                <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                  После загрузки видео вы увидите прогресс обработки в реальном времени. Вы можете закрыть страницу — обработка продолжится в фоновом режиме. Мы отправим уведомление, когда монтажный лист будет готов.
                </p>
              </div>
            </div>
          </section>

          {/* Тарифные планы */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-5 items-start w-full">
              <h2 className="font-jost font-medium text-[26px] leading-[1.2] text-white w-full">
                Тарифные планы
              </h2>
              <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                Мы предлагаем гибкие тарифные планы для разных потребностей — от тестирования сервиса до обработки больших объемов видео для киностудий.
              </p>

              <div className="flex flex-col gap-3 items-start w-full">
                <div className="bg-[#191919] flex flex-col gap-5 p-5 rounded-xl w-full">
                  <div className="flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Free — Бесплатный тариф
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Попробуйте сервис бесплатно. Создайте один монтажный лист для видео длительностью до 30 минут. Идеально подходит для знакомства с возможностями платформы.
                    </p>
                  </div>
                </div>

                <div className="bg-[#191919] flex flex-col gap-5 p-5 rounded-xl w-full">
                  <div className="flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Start — Начальный тариф
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Для фрилансеров и небольших проектов. Обработка до 300 минут видео, что эквивалентно 3-4 полнометражным фильмам. Техническая поддержка включена.
                    </p>
                  </div>
                </div>

                <div className="bg-[#191919] flex flex-col gap-5 p-5 rounded-xl w-full">
                  <div className="flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Studio — Профессиональный тариф
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Для студий и продакшн-компаний. 1000 минут обработки (10-15 фильмов), приоритетная обработка и расширенная техническая поддержка.
                    </p>
                  </div>
                </div>

                <div className="bg-[#191919] flex flex-col gap-5 p-5 rounded-xl w-full">
                  <div className="flex flex-col gap-3">
                    <p className="font-jost font-semibold text-[18px] leading-[26px] text-white">
                      Enterprise — Корпоративный тариф
                    </p>
                    <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                      Индивидуальные условия для крупных компаний с большими объемами. Гибкое количество минут, максимальные скидки, приоритетная обработка и персональный менеджер.
                    </p>
                  </div>
                </div>
              </div>

              <p className="font-jost font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
                Подробную информацию о ценах и возможностях каждого тарифа смотрите на{' '}
                <Link href="/pricing" className="underline">
                  странице планов
                </Link>
              </p>
            </div>
          </section>

          {/* FAQ */}
          <section className="flex flex-col gap-12 items-start pb-16">
            <div className="flex flex-col gap-5 items-start w-full">
              <h2 className="font-jost font-medium text-[26px] leading-[1.2] text-white w-full">
                Часто задаваемые вопросы
              </h2>
              <div className="flex flex-col gap-3 items-start w-full">
                {faqData.map((faq, index) => (
                  <FAQItem
                    key={index}
                    question={faq.question}
                    answer={faq.answer}
                    isOpen={openFAQIndex === index}
                    onToggle={() => setOpenFAQIndex(openFAQIndex === index ? null : index)}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Contact Section */}
          <section className="text-center pt-8">
            <div className="bg-[#191919] border border-[#2a2a2a] rounded-lg p-8">
              <h2 className="font-jost font-semibold text-[28px] leading-[38px] text-white mb-3">
                Остались вопросы?
              </h2>
              <p className="font-jost font-normal text-[16px] leading-[26px] text-[#d4d4d4] mb-6">
                Наша служба поддержки всегда готова помочь вам разобраться с любыми вопросами
              </p>
              <a 
                href="#"
                className="inline-block bg-white box-border px-8 py-3 rounded-lg font-jost font-semibold text-[14px] leading-[20px] text-black hover:bg-[#e5e5e5] transition-colors"
              >
                Связаться с поддержкой
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

