import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/site';
import { SpeedTest } from '@/components/SpeedTest';

export const metadata: Metadata = pageMetadata(
  '/test',
  'Internet Speed Test — Broadband & Mobile, Kerala | netundo',
  'Run a free internet speed test: download, upload, latency and jitter. Your result adds to the Kerala map of broadband and mobile speeds by area.',
);

export default function TestPage() {
  return (
    <div className="max-w-5xl mx-auto pt-8 pb-4 px-4">
      <SpeedTest />
    </div>
  );
}
