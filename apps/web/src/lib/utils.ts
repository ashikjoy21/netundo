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
    result.push({ bytes, label: formatBytes(bytes), stats });
  }

  return result.sort((a, b) => a.bytes - b.bytes);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}kB`;
  return `${bytes}B`;
}

export const QUALITY_COLOR: Record<string, string> = {
  bad: '#ef4444',
  poor: '#f97316',
  average: '#eab308',
  good: '#22c55e',
  great: '#16a34a',
};
