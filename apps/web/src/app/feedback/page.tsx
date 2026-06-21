import type { Metadata } from 'next';
import { KERALA_VILLAGES } from '@/lib/keralaPlaces';
import { FeedbackForm } from '@/components/FeedbackForm';

const KERALA_DISTRICT_NAMES = Object.keys(KERALA_VILLAGES);

export const metadata: Metadata = {
  title: 'Feedback — netundo',
  description:
    'Report a bug, suggest a feature, or flag a data correction for netundo, the crowdsourced Kerala internet speed map.',
};

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange">Feedback</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-gray-950">
        Help us make netundo better.
      </h1>
      <p className="mt-4 text-base leading-7 text-gray-500">
        Found a bug, spotted a number that looks off, or have an idea? Tell us. netundo is community
        infrastructure and every report makes the Kerala speed map more accurate.
      </p>

      <FeedbackForm districts={KERALA_DISTRICT_NAMES} />
    </div>
  );
}
