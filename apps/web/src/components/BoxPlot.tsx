'use client';

import type { BoxStats } from '@/lib/utils';
import { formatBpsTick } from '@/lib/utils';

/** Shared box-and-whisker + scatter renderer, modelled on Cloudflare's speed test. */
function Plot({
  stats,
  values,
  maxValue,
  ticks,
  color,
  unit,
  tickFmt,
}: {
  stats: BoxStats;
  values?: number[];
  maxValue: number;
  ticks: number[];
  color: string;
  unit: string;
  tickFmt: (v: number) => string;
}) {
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / maxValue) * 100)).toFixed(2)}%`;

  const q1Pct = pct(stats.q1);
  const q3Pct = pct(stats.q3);
  const medPct = pct(stats.median);
  const minPct = pct(stats.min);
  const maxPct = pct(stats.max);

  return (
    <div className="px-4 pb-4 pt-2 bg-white">
      <div className="text-xs text-gray-500 mb-2">{unit}</div>
      <div className="relative h-8">
        {/* Gridlines at each tick */}
        {ticks.map((t) => (
          <div
            key={`g${t}`}
            className="absolute top-0 bottom-0 w-px bg-gray-100"
            style={{ left: pct(t) }}
          />
        ))}

        {/* Baseline track */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-200 -translate-y-1/2" />

        {/* Scatter dots for individual samples */}
        {values?.map((v, i) => (
          <div
            key={`d${i}`}
            className="absolute top-1/2 w-1.5 h-1.5 rounded-full -translate-y-1/2 -translate-x-1/2"
            style={{ left: pct(v), backgroundColor: color, opacity: 0.55 }}
          />
        ))}

        {/* Left whisker cap + line */}
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: minPct, backgroundColor: color }} />
        <div
          className="absolute top-1/2 h-px -translate-y-1/2"
          style={{ left: minPct, width: `calc(${q1Pct} - ${minPct})`, backgroundColor: color, opacity: 0.5 }}
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

        {/* Median */}
        <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2" style={{ left: medPct, backgroundColor: color }} />

        {/* Right whisker line + cap */}
        <div
          className="absolute top-1/2 h-px -translate-y-1/2"
          style={{ left: q3Pct, width: `calc(${maxPct} - ${q3Pct})`, backgroundColor: color, opacity: 0.5 }}
        />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: maxPct, backgroundColor: color }} />
      </div>

      {/* X-axis ticks */}
      <div className="relative mt-1 h-3">
        {ticks.map((t) => (
          <span
            key={`t${t}`}
            className="absolute text-[10px] text-gray-400 -translate-x-1/2 whitespace-nowrap"
            style={{ left: pct(t) }}
          >
            {tickFmt(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Shell({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
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
      {children}
    </details>
  );
}

interface BoxPlotRowProps {
  label: string;
  count: number;
  stats: BoxStats;
  values?: number[];
  maxValue: number;
  ticks: number[];
  color: string;
  unit?: string;
}

function BoxPlotRow({ label, count, stats, values, maxValue, ticks, color, unit = 'bps' }: BoxPlotRowProps) {
  return (
    <Shell label={label} count={count}>
      <Plot
        stats={stats}
        values={values}
        maxValue={maxValue}
        ticks={ticks}
        color={color}
        unit={unit}
        tickFmt={formatBpsTick}
      />
    </Shell>
  );
}

interface LatencyBoxPlotRowProps {
  label: string;
  count: number;
  stats: BoxStats;
  values?: number[];
  maxValue: number;
  ticks: number[];
  color: string;
}

function LatencyBoxPlotRow({ label, count, stats, values, maxValue, ticks, color }: LatencyBoxPlotRowProps) {
  return (
    <Shell label={label} count={count}>
      <Plot
        stats={stats}
        values={values}
        maxValue={maxValue}
        ticks={ticks}
        color={color}
        unit="ms"
        tickFmt={(v) => `${Math.round(v)}`}
      />
    </Shell>
  );
}

export { BoxPlotRow, LatencyBoxPlotRow };
