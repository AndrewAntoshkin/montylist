import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full bg-[#101010] border-t border-[#2e2e2e] mt-auto">
      <div className="max-w-[1400px] mx-auto px-8 py-6">
        <div className="flex items-center justify-between">
          {/* Left side - Copyright */}
          <div className="text-[#979797] text-sm">
            © 2025 Monty. Все права защищены.
          </div>

          {/* Right side - Links */}
          <div className="flex items-center gap-6">
            <Link
              href="#"
              className="text-[#979797] text-sm hover:text-white transition-colors"
            >
              Политика конфиденциальности
            </Link>
            <Link
              href="#"
              className="text-[#979797] text-sm hover:text-white transition-colors"
            >
              Условия использования
            </Link>
            <Link
              href="#"
              className="text-[#979797] text-sm hover:text-white transition-colors"
            >
              Поддержка
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

