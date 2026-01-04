import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="w-full bg-[#101010] mt-auto">
      <div className="max-w-[1400px] mx-auto px-8">
        <div className="flex items-center justify-center gap-12 py-6">
          {/* Logo */}
          <div className="flex items-center gap-1">
            <Image 
              src="/monty-logo.svg" 
              alt="Monty" 
              width={82} 
              height={24}
            />
          </div>
          
          {/* Copyright */}
          <p className="text-sm font-medium leading-[1.57] tracking-[-0.007em] text-[#5A5A5A]">
            Monty @ 2025. Все права защищены
          </p>
        </div>
      </div>
    </footer>
  );
}
