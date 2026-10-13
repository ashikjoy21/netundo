import { Hero } from '@/components/landing/Hero';
import { SpeedMap } from '@/components/landing/SpeedMap';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { StatsSection } from '@/components/landing/StatsSection';
import { ActiveOutages } from '@/components/outage/ActiveOutages';

export default function Home() {
  return (
    <div className="pb-4">
      <Hero />
      <div className="relative z-10 mx-auto -mt-6 max-w-3xl px-4 sm:-mt-12">
        <ActiveOutages />
      </div>
      <div className="max-w-6xl mx-auto px-4 space-y-20 py-16">
        <SpeedMap />
        <TrustStrip />
        <StatsSection />
      </div>
    </div>
  );
}
