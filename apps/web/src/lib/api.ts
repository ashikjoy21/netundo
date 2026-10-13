import type { AggregateRow, ConnectionKind } from './networkScore';

export const API_BASE = process.env.NEXT_PUBLIC_API_WORKER_URL ?? '';

export type AggregatePeriod = 'weekly' | 'monthly' | 'quarter' | 'all';

export interface BrandAggregateQuery {
  period?: AggregatePeriod;
  group?: 'district' | 'taluk' | 'village';
  district?: string;
  taluk?: string;
  kind?: ConnectionKind;
  brand?: string;
}

/** Fetch brand-grouped aggregates. Resolves to [] on any failure so callers can
 *  render their empty/fallback state instead of crashing. */
export async function fetchBrandAggregates(query: BrandAggregateQuery = {}): Promise<AggregateRow[]> {
  if (!API_BASE) return [];
  const params = new URLSearchParams({ by: 'brand' });
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  try {
    const res = await fetch(`${API_BASE}/v1/aggregate?${params}`);
    if (!res.ok) return [];
    const rows = (await res.json()) as AggregateRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
