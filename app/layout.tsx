import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from 'sonner';
import Footer from '@/components/Footer';
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: "Carête Montage - Создавайте монтажные листы за минуты",
  description: "Автоматическое создание монтажных листов для ваших видео с помощью AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${inter.variable} font-sans antialiased flex flex-col min-h-screen bg-[#101010]`}
      >
        <div className="flex-1 flex flex-col">
          {children}
        </div>
        <Footer />
        <Toaster 
          position="top-center" 
          theme="dark"
          toastOptions={{
            style: {
              background: '#191919',
              border: '1px solid #2e2e2e',
              color: '#ffffff',
            },
          }}
        />
      </body>
    </html>
  );
}
