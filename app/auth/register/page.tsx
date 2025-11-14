'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validation
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || email,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (data.user) {
        setSuccess(true);
      }
    } catch (err) {
      setError('Произошла ошибка при регистрации');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-[#101010] relative w-full h-screen">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[364px] text-center">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#3ea662] rounded-full mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">
              Проверьте вашу почту
            </h2>
            <p className="text-[#868686] mb-6">
              Мы отправили письмо с подтверждением на <br />
              <span className="text-white">{email}</span>
            </p>
            <p className="text-sm text-[#868686]">
              Пожалуйста, перейдите по ссылке в письме для активации аккаунта
            </p>
          </div>

          <Link
            href="/auth/login"
            className="text-[#3ea662] hover:text-[#2e8b50] transition-colors text-[14px]"
          >
            Вернуться на страницу входа
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#101010] relative w-full h-screen">
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
            <Link
              href="/auth/login"
              className="flex-1 h-[34px] rounded-[8px] flex items-center justify-center px-[12px] py-[10px] hover:bg-[#1c1c1c]/50 transition-colors"
            >
              <p className="text-[#bebbbb] text-[14px] leading-none tracking-[-0.3962px]">
                Вход
              </p>
            </Link>
            <div className="flex-1 bg-[#1c1c1c] h-[34px] rounded-[8px] flex items-center justify-center px-[12px] py-[10px]">
              <p className="text-white text-[14px] leading-none tracking-[-0.3962px] font-medium">
                Регистрация
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleRegister} className="flex flex-col gap-[12px] items-start w-full">
            <input
              type="text"
              placeholder="Имя (необязательно)"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="bg-[#2e2e2f] px-[16px] py-[12px] rounded-[12px] w-full text-white text-[16px] leading-[24px] tracking-[-0.3962px] font-medium placeholder-[#9f9f9f] focus:outline-none focus:ring-2 focus:ring-white"
            />
            
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
            
            <input
              type="password"
              placeholder="Подтвердите пароль"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? 'Загрузка...' : 'Зарегистрироваться'}
              </p>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


