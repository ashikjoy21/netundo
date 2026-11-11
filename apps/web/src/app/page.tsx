import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/site';
import { Hero } from '@/components/landing/Hero';
import { SpeedMap } from '@/components/landing/SpeedMap';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { StatsSection } from '@/components/landing/StatsSection';

export const metadata: Metadata = pageMetadata(
  '/',
  'netundo — Kerala Internet Speed Test & Outage Map',
  'Free internet speed test for Kerala. Check your broadband or mobile speed, compare providers in your area and see network quality across all 14 districts.',
);

export default function Home() {
  return (
    <div className="pb-4">
      <Hero />
      <div className="max-w-6xl mx-auto px-4 space-y-20 py-16">
        <SpeedMap />
        <TrustStrip />
        <StatsSection />
      </div>
    </div>
  );
}
