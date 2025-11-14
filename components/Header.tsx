'use client';

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
  return (
    <div className="fixed top-0 left-0 right-0 h-[62px] bg-[#191919] z-50">
      <div className="max-w-[1400px] mx-auto h-full px-8 flex items-center justify-between">
        {/* Logo */}
        <Link href="/dashboard">
          <Logo />
        </Link>

        {/* Right section */}
        <div className="flex items-center gap-5">
          {/* Navigation links */}
          <div className="flex items-center gap-6">
            <Link
              href="#"
              className="text-[#eaeaeb] text-[14px] font-medium tracking-[-0.098px] leading-[22px] hover:text-white transition-colors"
            >
              Про сервис
            </Link>
            <Link
              href="#"
              className="text-[#eaeaeb] text-[14px] font-medium tracking-[-0.098px] leading-[22px] hover:text-white transition-colors"
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

