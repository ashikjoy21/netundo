'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { BandwidthPoint } from '@cloudflare/speedtest';
import { bpsToMbps } from '@/lib/utils';

interface Props {
  points: BandwidthPoint[];
  color: string;
  fillColor: string;
  percentile?: number; // the 90th pct value in bps
  label: string;
  currentBps?: number;
  unit?: string;
}

interface ChartPoint {
  t: number;
  mbps: number;
}

export function SpeedChart({ points, color, fillColor, percentile, label, currentBps }: Props) {
  const data = useMemo<ChartPoint[]>(() => {
    if (!points.length) return [];
    const first = points[0].measTime.getTime();
    return points.map((p) => ({
      t: Math.round((p.measTime.getTime() - first) / 1000),
      mbps: Math.round(bpsToMbps(p.bps) * 10) / 10,
    }));
  }, [points]);

  const pctMbps = percentile != null ? bpsToMbps(percentile) : undefined;
  const currentMbps = currentBps != null ? bpsToMbps(currentBps) : undefined;

  const yMax = useMemo(() => {
    if (!data.length) return 100;
    const max = Math.max(...data.map((d) => d.mbps), pctMbps ?? 0, currentMbps ?? 0);
    return Math.ceil(max * 1.2) || 100;
  }, [data, pctMbps, currentMbps]);

  return (
    <div className="relative w-full h-full">
      {/* Big speed number */}
      <div className="absolute top-0 left-0 z-10 flex items-baseline gap-1">
        <span className="text-5xl font-bold text-gray-900 leading-none">
          {currentMbps != null
            ? currentMbps >= 1000
              ? (currentMbps / 1000).toFixed(2)
              : currentMbps.toFixed(1)
            : data.length
            ? data[data.length - 1].mbps.toFixed(1)
            : '—'}
        </span>
        <span className="text-xl text-gray-500 font-medium ml-1">
          {currentMbps != null && currentMbps >= 1000 ? 'Gbps' : 'Mbps'}
        </span>
      </div>

      <div className="pt-14 w-full h-full">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis domain={[0, yMax]} hide />
            {pctMbps != null && (
              <ReferenceLine
                y={pctMbps}
                stroke={color}
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                label={{
                  value: '90th percentile',
                  position: 'insideTopRight',
                  fontSize: 10,
                  fill: color,
                  opacity: 0.8,
                }}
              />
            )}
            <Tooltip
              formatter={(v: number) => [`${v} Mbps`, label]}
              labelFormatter={(t: number) => `${t}s`}
              contentStyle={{
                fontSize: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '4px 8px',
              }}
            />
            <Area
              type="monotone"
              dataKey="mbps"
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${label})`}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
