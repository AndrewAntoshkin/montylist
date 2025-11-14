'use client';

import { useState, useRef, useEffect } from 'react';
import { UserCircleIcon, ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/types';

interface UserMenuProps {
  user: User;
  profile: Profile | null;
}

export default function UserMenu({ user, profile }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* User Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-7 h-7 rounded-full bg-[#222222] border border-[#2e2e2e] flex items-center justify-center hover:bg-[#2a2a2a] transition-colors"
      >
        <UserCircleIcon className="w-5 h-5 text-white" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-[#191919] border border-[#2e2e2e] rounded-xl shadow-lg overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[#2e2e2e]">
            <p className="text-white text-sm font-medium">Профиль</p>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">
            {/* Email */}
            <div>
              <label className="text-[#979797] text-xs font-medium">Логин (Email)</label>
              <div className="mt-1 px-3 py-2 bg-[#101010] border border-[#2e2e2e] rounded-lg">
                <p className="text-white text-sm truncate">{user.email}</p>
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[#979797] text-xs font-medium">Пароль</label>
              <div className="mt-1 px-3 py-2 bg-[#101010] border border-[#2e2e2e] rounded-lg">
                <p className="text-white text-sm">••••••••</p>
              </div>
            </div>

            {/* User ID */}
            <div>
              <label className="text-[#979797] text-xs font-medium">ID пользователя</label>
              <div className="mt-1 px-3 py-2 bg-[#101010] border border-[#2e2e2e] rounded-lg">
                <p className="text-white text-xs font-mono truncate">{user.id}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[#2e2e2e]">
            <button
              onClick={handleSignOut}
              className="w-full h-10 px-4 bg-[#191919] border border-[#2e2e2e] rounded-lg hover:bg-[#2a2a2a] transition-colors flex items-center justify-center gap-2"
            >
              <ArrowRightStartOnRectangleIcon className="w-4 h-4 text-white" />
              <span className="text-white text-sm font-medium">Выйти из профиля</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
