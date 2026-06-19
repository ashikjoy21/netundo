import { Hero } from '@/components/landing/Hero';
import { SpeedMap } from '@/components/landing/SpeedMap';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { StatsSection } from '@/components/landing/StatsSection';

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
