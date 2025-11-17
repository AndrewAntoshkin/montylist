import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PricingClient from '@/components/PricingClient';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Планы и цены - Carête Montage',
  description: 'Выберите план, подходящий под ваши запросы и приступайте к работе с монтажными листами',
};

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let profile = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    profile = data;
  }

  return (
    <div className="bg-[#191919] min-h-screen flex flex-col">
      <Header user={user || undefined} profile={profile} />
      
      {/* Main Content */}
      <div className="bg-[#101010] flex-1 box-border px-8 pt-[86px] pb-16">
        <div className="max-w-[1200px] mx-auto">
          {/* Header Section */}
          <div className="flex flex-col items-center justify-center overflow-clip pt-16 pb-14 gap-12">
            <div className="flex flex-col items-center gap-5 text-center max-w-[842px]">
              <h1 className="font-['Inter'] font-medium text-[56px] leading-[1.2] tracking-[-1.12px] text-white w-full">
                Сравнение планов
              </h1>
              <p className="font-['Inter'] font-medium text-[18px] leading-[1.2] text-[#727272] w-full">
                Выберите план, подходящий под ваши запросы и приступайте к работе
              </p>
            </div>
          </div>

          {/* Pricing and FAQ */}
          <PricingClient />
        </div>
      </div>

      <Footer />
    </div>
  );
}
