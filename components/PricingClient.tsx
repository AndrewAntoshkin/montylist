'use client';

import { useState } from 'react';
import Image from 'next/image';

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
    question: 'Как долго обрабатывается видео?',
    answer: 'Время обработки зависит от длительности и качества видео. В среднем, обработка занимает от 5 до 15 минут для видео длительностью до 90 минут.'
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

function FAQItem({ 
  question, 
  answer, 
  isOpen, 
  onToggle 
}: { 
  question: string; 
  answer: string; 
  isOpen: boolean; 
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[#6b6b6b] py-4 w-full">
      <button 
        className="flex gap-5 items-start justify-between w-full text-left"
        onClick={onToggle}
      >
        <div className="flex-1 flex flex-col gap-3">
          <p className="font-['Inter'] font-semibold text-[18px] leading-[26px] text-white">
            {question}
          </p>
          {isOpen && (
            <p className="font-['Inter'] font-normal text-[16px] leading-[24px] text-[#d3d3d3]">
              {answer}
            </p>
          )}
        </div>
        <div className={`bg-[#252525] flex items-center justify-center p-1 rounded-md shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <Image 
            src="/icons/chevron-down-small.svg" 
            alt="Toggle" 
            width={16} 
            height={16}
          />
        </div>
      </button>
    </div>
  );
}

export default function PricingClient() {
  const [openFAQIndex, setOpenFAQIndex] = useState<number | null>(1); // Second item open by default

  return (
    <>
      {/* Pricing Cards */}
      <div className="flex gap-4 items-stretch py-14 max-w-[1280px] mx-auto">
        {/* Start Plan */}
        <div className="flex-1 bg-[#191919] rounded-2xl p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-['Inter'] font-medium italic text-[20px] tracking-[-0.6px] text-white">
              Start
            </h2>
            <div className="flex items-center gap-2">
              <p className="font-['Inter'] font-bold text-[28px] leading-[1.2] text-white">
                30,000 ₽
              </p>
            </div>
            <p className="font-['Inter'] font-normal text-[14px] leading-[20px] text-[darkgrey]">
              базовый уровень
            </p>
          </div>

          <div className="flex-1 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[16px] leading-[20px] text-white">
                300 минут
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[16px] leading-[20px] text-white">
                100₽ / мин
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-white">
                Техническая поддержка
              </p>
            </div>
          </div>

          <button className="bg-white rounded-lg px-6 py-3 w-full hover:bg-gray-100 transition-colors">
            <span className="font-['Inter'] font-semibold text-[14px] leading-[20px] text-black">
              КУПИТЬ
            </span>
          </button>
        </div>

        {/* Studio Plan */}
        <div className="flex-1 bg-[#191919] rounded-2xl p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-['Inter'] font-medium italic text-[20px] tracking-[-0.6px] text-white">
              Studio
            </h2>
            <div className="flex items-center gap-2">
              <p className="font-['Inter'] font-bold text-[28px] leading-[1.2] text-white">
                80,000 ₽
              </p>
              <div className="border border-[#21d839] rounded-full px-2.5 py-1">
                <span className="font-['Inter'] font-semibold text-[14px] leading-[1.4] tracking-[0.14px] text-[#7dff86]">
                  -20%
                </span>
              </div>
            </div>
            <p className="font-['Inter'] font-normal text-[14px] leading-[20px] text-[darkgrey]">
              вместо 100,000₽
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[16px] leading-[20px] text-white">
                1000 минут
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[16px] leading-[20px] text-white">
                80₽ / мин
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-white">
                Техническая поддержка
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle-filled.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-white">
                Приоритет обработки
              </p>
            </div>
          </div>

          <button className="bg-white rounded-lg px-6 py-3 w-full hover:bg-gray-100 transition-colors">
            <span className="font-['Inter'] font-semibold text-[14px] leading-[20px] text-black">
              КУПИТЬ
            </span>
          </button>
        </div>

        {/* Enterprise Plan */}
        <div className="flex-1 bg-white border border-[#e4e4e4] rounded-2xl p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2 h-[94px]">
            <h2 className="font-['Inter'] font-medium italic text-[20px] tracking-[-0.6px] text-black">
              Enterprise
            </h2>
            <p className="font-['Inter'] font-bold text-[18px] leading-[1.2] text-black">
              Стоимость зависит от количества минут
            </p>
          </div>

          <div className="flex-1 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-black">
                Выбор количества минут
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-black">
                Максимальная скидка -50%
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-black">
                Техническая поддержка
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Image 
                src="/icons/check-circle.svg" 
                alt="Check" 
                width={20} 
                height={20}
                className="shrink-0"
              />
              <p className="font-['Inter'] font-normal text-[14px] leading-[1.5] text-black">
                Приоритет обработки
              </p>
            </div>
          </div>

          <button className="bg-black rounded-lg px-6 py-3 w-full hover:bg-gray-900 transition-colors">
            <span className="font-['Inter'] font-semibold text-[14px] leading-[20px] text-white">
              РАССЧИТАТЬ
            </span>
          </button>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="flex flex-col gap-12 items-start overflow-clip pt-8 pb-16 max-w-[880px] mx-auto">
        <div className="flex flex-col gap-5 w-full">
          <h2 className="font-['Inter'] font-medium text-[26px] leading-[1.2] text-white w-full">
            Часто задаваемые вопросы
          </h2>
          <div className="flex flex-col w-full">
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
      </div>
    </>
  );
}




