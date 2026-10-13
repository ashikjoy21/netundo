/**
 * Brand-grouped aggregation for /v1/aggregate?by=brand.
 *
 * Each test is resolved to a provider brand + connection kind (home broadband
 * vs mobile data) via packages/types/src/providers.ts, then bucketed by place,
 * brand and kind. VPN / hosting networks are dropped. Pure functions only, so
 * this can be unit-tested without Supabase.
 */

import { resolveProvider, type ConnectionKind } from '@netundo/types';

export interface BrandTestRow {
  district: string;
  taluk?: string | null;
  village?: string | null;
  isp_name: string | null;
  asn: number | null;
  connection_type: string;
  provider_reported?: string | null;
  provider_reported_name?: string | null;
  download_mbps: number | null;
  upload_mbps: number | null;
  latency_ms: number | null;
  jitter_ms: number | null;
  created_at: string;
}

export interface BrandAggregateRow {
  district: string;
  taluk?: string | null;
  village?: string | null;
  brand_key: string;
  /** Display name for the brand (kept as `isp_name` for older consumers). */
  isp_name: string;
  kind: ConnectionKind;
  asns: number[];
  /** Share of tests whose brand came from the user's own answer (0–1). */
  self_reported_share: number;
  sample_count: number;
  latest_at: string;
  p50_download_mbps: number | null;
  p90_download_mbps: number | null;
  avg_download_mbps: number | null;
  p50_upload_mbps: number | null;
  p90_upload_mbps: number | null;
  p50_latency_ms: number | null;
  avg_latency_ms: number | null;
  p50_jitter_ms: number | null;
}

export type PlaceGrouping = 'district' | 'taluk' | 'village';

/** Percentile on a sorted numeric array (linear interpolation). */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregateByBrand(
  rows: BrandTestRow[],
  grouping: PlaceGrouping = 'district',
  filter?: { brand?: string | null; kind?: string | null },
): BrandAggregateRow[] {
  type Bucket = {
    first: BrandTestRow;
    brandKey: string;
    names: Map<string, number>;
    kind: ConnectionKind;
    asns: Set<number>;
    selfReported: number;
    rows: BrandTestRow[];
  };
  const groups = new Map<string, Bucket>();

  for (const row of rows) {
    const p = resolveProvider({
      asn: row.asn,
      ispOrg: row.isp_name,
      connectionType: row.connection_type,
      reported: row.provider_reported,
      reportedName: row.provider_reported_name,
    });
    if (p.excluded) continue;
    if (filter?.brand && p.brandKey !== filter.brand) continue;
    if (filter?.kind && p.kind !== filter.kind) continue;

    const place =
      grouping === 'district'
        ? row.district
        : grouping === 'taluk'
          ? `${row.district}|${row.taluk ?? ''}`
          : `${row.district}|${row.taluk ?? ''}|${row.village ?? ''}`;
    const key = `${place}|${p.brandKey}|${p.kind}`;

    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { first: row, brandKey: p.brandKey, names: new Map(), kind: p.kind, asns: new Set(), selfReported: 0, rows: [] };
      groups.set(key, bucket);
    }
    bucket.rows.push(row);
    bucket.names.set(p.displayName, (bucket.names.get(p.displayName) ?? 0) + 1);
    if (row.asn != null) bucket.asns.add(row.asn);
    if (p.selfReported) bucket.selfReported += 1;
  }

  return [...groups.values()].map((b) => {
    const nums = (field: 'download_mbps' | 'upload_mbps' | 'latency_ms' | 'jitter_ms') =>
      b.rows
        .map((r) => r[field])
        .filter((v): v is number => typeof v === 'number')
        .sort((x, y) => x - y);
    const name = [...b.names.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const latest = b.rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), b.rows[0].created_at);
    const down = nums('download_mbps');
    const lat = nums('latency_ms');

    return {
      district: b.first.district,
      ...(grouping !== 'district' ? { taluk: b.first.taluk ?? null } : {}),
      ...(grouping === 'village' ? { village: b.first.village ?? null } : {}),
      brand_key: b.brandKey,
      isp_name: name,
      kind: b.kind,
      asns: [...b.asns].sort((x, y) => x - y),
      self_reported_share: b.rows.length ? b.selfReported / b.rows.length : 0,
      sample_count: b.rows.length,
      latest_at: latest,
      p50_download_mbps: percentile(down, 0.5),
      p90_download_mbps: percentile(down, 0.9),
      avg_download_mbps: mean(down),
      p50_upload_mbps: percentile(nums('upload_mbps'), 0.5),
      p90_upload_mbps: percentile(nums('upload_mbps'), 0.9),
      p50_latency_ms: percentile(lat, 0.5),
      avg_latency_ms: mean(lat),
      p50_jitter_ms: percentile(nums('jitter_ms'), 0.5),
    };
  });
}
