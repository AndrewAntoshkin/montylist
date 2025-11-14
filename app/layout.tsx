import type { Metadata } from "next";
import { Jost } from "next/font/google";
import { Toaster } from 'sonner';
import "./globals.css";

const jost = Jost({
  variable: "--font-jost",
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
        className={`${jost.variable} font-sans antialiased`}
      >
        {children}
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
