'use client';

import { useState, useRef, useEffect } from 'react';
import {
  UserCircleIcon,
  ArrowRightStartOnRectangleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();
  const enhancedProfile = profile as Profile & {
    plan_name?: string;
    plan_usage_text?: string;
    plan_minutes_used?: number;
    plan_minutes_total?: number;
  };
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const getStringFromMetadata = (keys: string[]) => {
    for (const key of keys) {
      const value = appMetadata[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    for (const key of keys) {
      const value = userMetadata[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  };

  const getNumberFromMetadata = (keys: string[]) => {
    for (const key of keys) {
      const value = appMetadata[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    for (const key of keys) {
      const value = userMetadata[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return undefined;
  };

  const planName =
    enhancedProfile?.plan_name ?? getStringFromMetadata(['plan_name', 'plan']) ?? 'Studio';
  const planMinutesUsed =
    enhancedProfile?.plan_minutes_used ?? getNumberFromMetadata(['plan_minutes_used', 'planMinutesUsed']);
  const planMinutesTotal =
    enhancedProfile?.plan_minutes_total ?? getNumberFromMetadata(['plan_minutes_total', 'planMinutesTotal']);
  const planUsageText =
    enhancedProfile?.plan_usage_text ??
    (planMinutesUsed !== undefined && planMinutesTotal !== undefined
      ? `${planMinutesUsed.toLocaleString('ru-RU')} / ${planMinutesTotal.toLocaleString('ru-RU')} минут`
      : '356 / 1,000 минут');
  const passwordHint =
    (typeof userMetadata.password_hint === 'string'
      ? (userMetadata.password_hint as string)
      : typeof userMetadata.passwordHint === 'string'
        ? (userMetadata.passwordHint as string)
        : undefined) ?? 'fw2w8cbc8f333';
  const passwordDisplay = isPasswordVisible ? passwordHint : '••••••••';

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
        <div className="absolute right-0 mt-2 w-80 bg-[#111111] border border-[#262626] rounded-2xl shadow-[0_12px_24px_rgba(0,0,0,0.45)] overflow-hidden z-50">
          <div className="px-4 py-5 space-y-4">
            <p className="text-white text-sm font-medium">Профиль</p>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-[#8c8a87] text-xs font-medium tracking-wide">
                Логин
              </label>
              <div className="h-10 px-3 bg-[#1e1e1e] rounded-2xl flex items-center border border-transparent">
                <p className="text-white text-sm truncate">{user.email}</p>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-[#8c8a87] text-xs font-medium tracking-wide">Пароль</label>
              <div className="h-10 px-3 bg-[#1e1e1e] rounded-2xl flex items-center justify-between border border-transparent">
                <p className="text-white text-sm">
                  {passwordDisplay}
                </p>
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible((prev) => !prev)}
                  className="text-[#979797] hover:text-white transition-colors"
                  aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {isPasswordVisible ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* User ID */}
            <div className="space-y-2">
              <label className="text-[#8c8a87] text-xs font-medium tracking-wide">
                ID пользователя
              </label>
              <div className="h-10 px-3 bg-[#1e1e1e] rounded-2xl flex items-center border border-transparent">
                <p className="text-white text-xs font-mono truncate">{user.id}</p>
              </div>
            </div>

            {/* Plan card */}
            <div className="bg-[#191919] border border-[#2e2e2e] rounded-xl p-4 space-y-3">
              <div>
                <p className="text-[#8c8a87] text-sm font-medium">План</p>
                <p className="text-white text-2xl font-medium italic tracking-tight mt-1">
                  {planName}
                </p>
              </div>
              <div className="h-10 px-3 bg-[#1e1e1e] rounded-2xl flex items-center">
                <p className="text-white text-sm font-medium">
                  {planUsageText}
                </p>
              </div>
              <button
                type="button"
                className="h-9 rounded-lg bg-white text-black text-sm font-semibold w-full hover:bg-[#f3f3f3] transition-colors"
              >
                Изменить
              </button>
            </div>

            <button
              onClick={handleSignOut}
              className="w-full h-11 rounded-xl border border-[#2e2e2e] text-white text-sm font-medium tracking-wide hover:bg-[#1c1c1c] transition-colors flex items-center justify-center gap-2"
            >
              <ArrowRightStartOnRectangleIcon className="w-4 h-4 text-white" />
              Выход
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

