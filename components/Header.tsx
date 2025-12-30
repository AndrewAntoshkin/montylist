'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Logo from './Logo';
import UserMenu from './UserMenu';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/types';

interface HeaderProps {
  user?: User;
  profile?: Profile | null;
}

export default function Header({ user, profile }: HeaderProps = {}) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Если прокрутили больше 10px, меняем фон
      setIsScrolled(window.scrollY > 10);
    };

    // Добавляем слушатель события скролла
    window.addEventListener('scroll', handleScroll);

    // Проверяем начальное состояние
    handleScroll();

    // Очищаем слушатель при размонтировании
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="sticky top-3 z-50 flex justify-center">
      <div className={`h-[62px] rounded-[24px] w-[calc(100%-64px)] max-w-[1427px] px-6 py-5 flex items-center justify-between transition-colors duration-300 ${isScrolled ? 'bg-[#191919]' : 'bg-[#101010]'}`}>
        {/* Logo */}
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        {/* Right section */}
        <div className="flex items-center gap-5 grow justify-end">
          {/* Navigation links */}
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-[#eaeaeb] text-sm font-medium tracking-[-0.098px] leading-[22px] hover:text-white transition-colors whitespace-nowrap"
            >
              Листы
            </Link>
            <Link
              href="#"
              className="text-[#eaeaeb] text-sm font-medium tracking-[-0.098px] leading-[22px] hover:text-white transition-colors whitespace-nowrap"
            >
              Поддержка
            </Link>
          </div>

          {/* User Menu */}
          {user && <UserMenu user={user} profile={profile || null} />}
        </div>
      </div>
    </div>
  );
}

