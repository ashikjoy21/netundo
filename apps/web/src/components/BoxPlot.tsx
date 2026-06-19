'use client';

import { useMemo } from 'react';
import type { BoxStats } from '@/lib/utils';

interface BoxPlotRowProps {
  label: string;
  count: number;
  stats: BoxStats;
  maxValue: number;
  color: string;
  unit?: string;
  convertFn?: (v: number) => number;
}

function BoxPlotRow({ label, count, stats, maxValue, color, unit = 'bps', convertFn }: BoxPlotRowProps) {
  const convert = convertFn ?? ((v) => v / 1_000_000);
  const fmt = (v: number) => {
    const c = convert(v);
    return c >= 1000 ? `${(c / 1000).toFixed(2)}G` : `${c.toFixed(0)}M`;
  };

  const pct = (v: number) => `${Math.min(100, (v / maxValue) * 100).toFixed(2)}%`;

  const q1Pct = pct(stats.q1);
  const q3Pct = pct(stats.q3);
  const medPct = pct(stats.median);
  const minPct = pct(stats.min);
  const maxPct = pct(stats.max);

  return (
    <details className="group border border-gray-200 rounded-lg overflow-hidden" open>
      <summary className="flex items-center justify-between px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 select-none list-none">
        <span className="text-sm font-medium text-gray-700">
          {label} <span className="text-gray-400 font-normal">({count}/{count})</span>
        </span>
        <svg
          className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>

      <div className="px-4 pb-4 pt-2 bg-white">
        <div className="text-xs text-gray-500 mb-2">{unit}</div>
        <div className="relative h-8">
          {/* Track */}
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-200 -translate-y-1/2" />

          {/* Whisker left */}
          <div
            className="absolute top-1/2 h-3 w-px -translate-y-1/2"
            style={{ left: minPct, backgroundColor: color }}
          />
          {/* Whisker line left */}
          <div
            className="absolute top-1/2 h-px -translate-y-1/2"
            style={{
              left: minPct,
              width: `calc(${q1Pct} - ${minPct})`,
              backgroundColor: color,
              opacity: 0.5,
            }}
          />

          {/* Box */}
          <div
            className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm"
            style={{
              left: q1Pct,
              width: `calc(${q3Pct} - ${q1Pct})`,
              backgroundColor: color,
              opacity: 0.25,
              border: `1.5px solid ${color}`,
            }}
          />

          {/* Median line */}
          <div
            className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2"
            style={{ left: medPct, backgroundColor: color }}
          />

          {/* Whisker line right */}
          <div
            className="absolute top-1/2 h-px -translate-y-1/2"
            style={{
              left: q3Pct,
              width: `calc(${maxPct} - ${q3Pct})`,
              backgroundColor: color,
              opacity: 0.5,
            }}
          />
          {/* Whisker right */}
          <div
            className="absolute top-1/2 h-3 w-px -translate-y-1/2"
            style={{ left: maxPct, backgroundColor: color }}
          />
        </div>

        {/* X-axis ticks */}
        <div className="flex justify-between mt-1 text-[10px] text-gray-400">
          <span>0</span>
          <span>{fmt(maxValue / 2)}</span>
          <span>{fmt(maxValue)}</span>
        </div>
      </div>
    </details>
  );
}

interface LatencyBoxPlotRowProps {
  label: string;
  count: number;
  stats: BoxStats;
  maxValue: number;
  color: string;
}

function LatencyBoxPlotRow({ label, count, stats, maxValue, color }: LatencyBoxPlotRowProps) {
  const pct = (v: number) => `${Math.min(100, (v / maxValue) * 100).toFixed(2)}%`;

  const q1Pct = pct(stats.q1);
  const q3Pct = pct(stats.q3);
  const medPct = pct(stats.median);
  const minPct = pct(stats.min);
  const maxPct = pct(stats.max);

  return (
    <details className="group border border-gray-200 rounded-lg overflow-hidden" open>
      <summary className="flex items-center justify-between px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 select-none list-none">
        <span className="text-sm font-medium text-gray-700">
          {label} <span className="text-gray-400 font-normal">({count}/{count})</span>
        </span>
        <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 pt-2 bg-white">
        <div className="text-xs text-gray-500 mb-2">ms</div>
        <div className="relative h-8">
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-200 -translate-y-1/2" />
          <div className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: minPct, backgroundColor: color }} />
          <div className="absolute top-1/2 h-px -translate-y-1/2" style={{ left: minPct, width: `calc(${q1Pct} - ${minPct})`, backgroundColor: color, opacity: 0.5 }} />
          <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm" style={{ left: q1Pct, width: `calc(${q3Pct} - ${q1Pct})`, backgroundColor: color, opacity: 0.2, border: `1.5px solid ${color}` }} />
          <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2" style={{ left: medPct, backgroundColor: color }} />
          <div className="absolute top-1/2 h-px -translate-y-1/2" style={{ left: q3Pct, width: `calc(${maxPct} - ${q3Pct})`, backgroundColor: color, opacity: 0.5 }} />
          <div className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: maxPct, backgroundColor: color }} />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-gray-400">
          <span>0</span>
          <span>{Math.round(maxValue / 2)}</span>
          <span>{Math.round(maxValue)}</span>
        </div>
      </div>
    </details>
  );
}

export { BoxPlotRow, LatencyBoxPlotRow };
