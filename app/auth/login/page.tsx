'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (data.user) {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('Произошла ошибка при входе');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#101010] relative w-full flex-1">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[364px] flex flex-col gap-[28px] items-center">
        {/* Logo and tagline */}
        <div className="flex flex-col gap-[16px] items-center justify-end w-full">
          <div className="h-[32px] w-[109.83px] relative">
            <Image
              src="/icons/monty-logo.svg"
              alt="Monty"
              fill
              className="object-contain"
            />
          </div>
          <p className="text-[#868686] text-[16px] text-center leading-[1.2] tracking-[-0.3962px] w-[364px]">
            Создавайте монтажные листы за минуты
          </p>
        </div>

        {/* Form section */}
        <div className="flex flex-col gap-[16px] items-start w-full">
          {/* Tab Switcher */}
          <div className="bg-[#2e2e2e] p-[4px] rounded-[12px] w-full flex gap-[8px]">
            <div className="flex-1 bg-[#1c1c1c] h-[34px] rounded-[8px] flex items-center justify-center px-[12px] py-[10px]">
              <p className="text-white text-[14px] leading-none tracking-[-0.3962px] font-medium">
                Вход
              </p>
            </div>
            <Link
              href="/auth/register"
              className="flex-1 h-[34px] rounded-[8px] flex items-center justify-center px-[12px] py-[10px] hover:bg-[#1c1c1c]/50 transition-colors"
            >
              <p className="text-[#bebbbb] text-[14px] leading-none tracking-[-0.3962px]">
                Регистрация
              </p>
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-[12px] items-start w-full">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-[#2e2e2f] px-[16px] py-[12px] rounded-[12px] w-full text-white text-[16px] leading-[24px] tracking-[-0.3962px] font-medium placeholder-[#9f9f9f] focus:outline-none focus:ring-2 focus:ring-white"
            />
            
            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-[#2e2e2f] px-[16px] py-[12px] rounded-[12px] w-full text-white text-[16px] leading-[24px] tracking-[-0.3962px] font-medium placeholder-[#9f9f9f] focus:outline-none focus:ring-2 focus:ring-white"
            />

            {error && (
              <div className="text-red-400 text-sm text-center bg-red-500/10 py-2 px-4 rounded-lg w-full">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="bg-[#f0f0f5] px-[16px] py-[12px] rounded-[12px] w-full flex items-center justify-center hover:bg-[#e0e0e5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <p className="text-[#141414] text-[16px] leading-[24px] tracking-[-0.3962px] font-medium">
                {loading ? 'Загрузка...' : 'Войти'}
              </p>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


