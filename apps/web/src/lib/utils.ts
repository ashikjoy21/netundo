import type { BandwidthPoint } from '@cloudflare/speedtest';
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function bpsToMbps(bps: number): number {
  return bps / 1_000_000;
}

export function formatMbps(bps?: number, decimals = 1): string {
  if (bps == null) return '—';
  const mbps = bpsToMbps(bps);
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(decimals)} Gbps`;
  return `${mbps.toFixed(decimals)}`;
}

export function formatMs(ms?: number | null): string {
  if (ms == null) return '—';
  return `${ms.toFixed(1)}`;
}

export function formatPct(ratio?: number): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(1)}`;
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
}

export function computeBoxStats(values: number[]): BoxStats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (p: number) => {
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return {
    min: sorted[0],
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[n - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / n,
    count: n,
  };
}

// Group BandwidthPoints by payload size and compute box stats per group
export interface BandwidthGroup {
  bytes: number;
  label: string;
  stats: BoxStats;
  values: number[];
}

export function groupBandwidthBySize(points: BandwidthPoint[]): BandwidthGroup[] {
  const groups = new Map<number, number[]>();
  for (const p of points) {
    const arr = groups.get(p.bytes) ?? [];
    arr.push(p.bps);
    groups.set(p.bytes, arr);
  }

  const result: BandwidthGroup[] = [];
  for (const [bytes, bpsList] of groups) {
    const stats = computeBoxStats(bpsList);
    if (!stats) continue;
    result.push({ bytes, label: formatBytes(bytes), stats, values: bpsList });
  }

  return result.sort((a, b) => a.bytes - b.bytes);
}

/**
 * "Nice" axis bounds, like Cloudflare's speed-test box plots: rounds the max up
 * to a clean 1/2/2.5/5 × 10ⁿ value and returns evenly spaced tick marks. This is
 * what makes the axes read 0 / 50M / 100M … instead of 0 / 153M / 307M.
 */
export function niceAxis(rawMax: number, targetTicks = 6): { max: number; ticks: number[] } {
  if (!rawMax || rawMax <= 0 || !Number.isFinite(rawMax)) return { max: 1, ticks: [0, 1] };
  const rough = rawMax / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= pow;
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return { max, ticks };
}

/** Compact bandwidth tick label: 50_000_000 → "50M", 1_500_000_000 → "1.5G". */
export function formatBpsTick(bps: number): string {
  const mbps = bps / 1_000_000;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1)}G`;
  return `${Math.round(mbps)}M`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}kB`;
  return `${bytes}B`;
}

/**
 * Cloudflare colo (IATA airport) → human city name. Covers the data centers a
 * Kerala/India user is realistically routed to, plus nearby Asian hubs, so the
 * "Server location" reads like Cloudflare's ("Chennai" not "MAA"). Unknown codes
 * fall back to the raw colo.
 */
export const COLO_CITY: Record<string, string> = {
  MAA: 'Chennai',
  BOM: 'Mumbai',
  DEL: 'New Delhi',
  HYD: 'Hyderabad',
  BLR: 'Bengaluru',
  CCU: 'Kolkata',
  NAG: 'Nagpur',
  AMD: 'Ahmedabad',
  KNU: 'Kanpur',
  PAT: 'Patna',
  COK: 'Kochi',
  TRV: 'Thiruvananthapuram',
  CMB: 'Colombo',
  SIN: 'Singapore',
  CGP: 'Chattogram',
  DAC: 'Dhaka',
  KTM: 'Kathmandu',
  MLE: 'Malé',
  DXB: 'Dubai',
  FJR: 'Fujairah',
};

export function coloCity(colo?: string | null): string | null {
  if (!colo) return null;
  return COLO_CITY[colo] ?? null;
}

export const QUALITY_COLOR: Record<string, string> = {
  bad: '#ef4444',
  poor: '#f97316',
  average: '#eab308',
  good: '#22c55e',
  great: '#16a34a',
};
