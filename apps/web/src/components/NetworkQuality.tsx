'use client';

import type { Scores } from '@cloudflare/speedtest';
import { QUALITY_COLOR } from '@/lib/utils';

interface Props {
  scores: Scores | null;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  streaming: 'Video Streaming',
  gaming: 'Online Gaming',
  rtc: 'Video Chatting',
};

export function NetworkQuality({ scores }: Props) {
  const experiences = scores
    ? Object.entries(scores).filter(([k]) => k in EXPERIENCE_LABELS)
    : null;

  return (
    <div className="border-t border-b border-gray-200 py-4 px-4 md:px-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-gray-800">Network Quality Score</span>
        <InfoIcon />
      </div>

      <div className="flex flex-col md:flex-row md:divide-x md:divide-gray-200 gap-3 md:gap-0">
        {experiences
          ? experiences.map(([key, score], i) => (
              <div key={key} className={`flex items-center gap-2 md:px-8 ${i === 0 ? 'md:pl-0' : ''}`}>
                <span className="text-sm text-gray-600">{EXPERIENCE_LABELS[key] ?? key}:</span>
                <span
                  className="text-sm font-semibold capitalize"
                  style={{ color: QUALITY_COLOR[score.classificationName] ?? '#6b7280' }}
                >
                  {score.classificationName}
                </span>
              </div>
            ))
          : ['Video Streaming', 'Online Gaming', 'Video Chatting'].map((label, i) => (
              <div key={label} className={`flex items-center gap-2 md:px-8 ${i === 0 ? 'md:pl-0' : ''}`}>
                <span className="text-sm text-gray-500">{label}:</span>
                <span className="text-sm text-gray-300">—</span>
              </div>
            ))}
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-gray-400">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v5M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
