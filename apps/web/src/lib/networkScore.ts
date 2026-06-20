export type UseCase = 'overall' | 'streaming' | 'gaming' | 'videoCalls' | 'work';

export interface AggregateRow {
  district: string;
  asn: number | null;
  isp_name: string | null;
  connection_type: string;
  sample_count: number;
  p50_download_mbps: number | null;
  p90_download_mbps: number | null;
  avg_download_mbps?: number | null;
  p50_upload_mbps?: number | null;
  p90_upload_mbps?: number | null;
  p50_latency_ms: number | null;
  avg_latency_ms?: number | null;
  p50_jitter_ms?: number | null;
}

/** Sample-weighted mean of a numeric field across aggregate rows (true district average when field is avg_*). */
export function weightedMean(
  rows: AggregateRow[],
  field: keyof AggregateRow,
): number | null {
  const usable = rows.filter(
    (row) => typeof row[field] === 'number' && row.sample_count > 0,
  );
  const weightTotal = usable.reduce((sum, row) => sum + row.sample_count, 0);
  if (!weightTotal) return null;
  return (
    usable.reduce((sum, row) => sum + (row[field] as number) * row.sample_count, 0) /
    weightTotal
  );
}

export interface ScoredNetwork {
  key: string;
  name: string;
  asn: number | null;
  district: string;
  connectionType: string;
  samples: number;
  score: number;
  confidence: number;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  grade: 'Elite' | 'Great' | 'Good' | 'Fair' | 'Needs data';
  bestFor: UseCase;
}

export const USE_CASES: Array<{ id: UseCase; label: string; shortLabel: string; description: string }> = [
  {
    id: 'overall',
    label: 'Overall quality',
    shortLabel: 'Overall',
    description: 'Balanced score for everyday browsing, downloads, calls, and stability.',
  },
  {
    id: 'streaming',
    label: 'Streaming',
    shortLabel: 'Streaming',
    description: 'Prioritizes download speed and stable latency for HD and 4K video.',
  },
  {
    id: 'gaming',
    label: 'Gaming',
    shortLabel: 'Gaming',
    description: 'Prioritizes low latency and jitter, then enough speed for live games.',
  },
  {
    id: 'videoCalls',
    label: 'Video calls',
    shortLabel: 'Calls',
    description: 'Balances upload, download, latency, and jitter for meetings.',
  },
  {
    id: 'work',
    label: 'Work from home',
    shortLabel: 'WFH',
    description: 'Rewards stable two-way bandwidth and responsive latency.',
  },
];

const WEIGHTS: Record<UseCase, { download: number; upload: number; latency: number; jitter: number }> = {
  overall: { download: 0.36, upload: 0.22, latency: 0.28, jitter: 0.14 },
  streaming: { download: 0.64, upload: 0.08, latency: 0.2, jitter: 0.08 },
  gaming: { download: 0.16, upload: 0.08, latency: 0.48, jitter: 0.28 },
  videoCalls: { download: 0.24, upload: 0.32, latency: 0.28, jitter: 0.16 },
  work: { download: 0.28, upload: 0.28, latency: 0.28, jitter: 0.16 },
};

export function scoreNetwork(row: AggregateRow, useCase: UseCase = 'overall'): ScoredNetwork {
  const downloadMbps = row.p50_download_mbps ?? row.p90_download_mbps ?? null;
  const uploadMbps = row.p50_upload_mbps ?? row.p90_upload_mbps ?? null;
  const latencyMs = row.p50_latency_ms;
  const jitterMs = row.p50_jitter_ms ?? null;
  const confidence = sampleConfidence(row.sample_count);
  const weights = WEIGHTS[useCase];

  const base =
    normalizeHigher(downloadMbps, 5, 150) * weights.download +
    normalizeHigher(uploadMbps, 2, 60) * weights.upload +
    normalizeLower(latencyMs, 10, 140) * weights.latency +
    normalizeLower(jitterMs, 2, 45) * weights.jitter;

  // Keep low-sample networks visible, but do not let one lucky test dominate.
  const score = clamp(base * 100 * (0.82 + confidence * 0.18), 0, 100);

  return {
    key: `${row.asn ?? row.isp_name ?? 'unknown'}-${row.district}-${row.connection_type}`,
    name: row.isp_name ?? 'Unknown ISP',
    asn: row.asn,
    district: row.district,
    connectionType: row.connection_type,
    samples: row.sample_count,
    score,
    confidence,
    downloadMbps,
    uploadMbps,
    latencyMs,
    jitterMs,
    grade: gradeForScore(score, row.sample_count),
    bestFor: bestUseCase(row),
  };
}

export function groupIspScores(rows: AggregateRow[], useCase: UseCase): ScoredNetwork[] {
  const buckets = new Map<string, AggregateRow[]>();
  for (const row of rows) {
    const key = String(row.asn ?? row.isp_name ?? 'unknown');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.values()]
    .map((bucket) => scoreNetwork(mergeRows(bucket), useCase))
    .sort((a, b) => b.score - a.score || b.samples - a.samples);
}

export function formatConnectionType(type: string): string {
  if (type === 'wifi') return 'Wi-Fi';
  if (type === 'wired') return 'Wired';
  if (type === 'mobile') return 'Mobile';
  return type || 'Unknown';
}

function bestUseCase(row: AggregateRow): UseCase {
  const useCases: UseCase[] = ['streaming', 'gaming', 'videoCalls', 'work'];
  return useCases
    .map((useCase) => ({ useCase, score: scoreOnly(row, useCase) }))
    .sort((a, b) => b.score - a.score)[0].useCase;
}

function scoreOnly(row: AggregateRow, useCase: UseCase): number {
  const downloadMbps = row.p50_download_mbps ?? row.p90_download_mbps ?? null;
  const uploadMbps = row.p50_upload_mbps ?? row.p90_upload_mbps ?? null;
  const latencyMs = row.p50_latency_ms;
  const jitterMs = row.p50_jitter_ms ?? null;
  const weights = WEIGHTS[useCase];

  return (
    normalizeHigher(downloadMbps, 5, 150) * weights.download +
    normalizeHigher(uploadMbps, 2, 60) * weights.upload +
    normalizeLower(latencyMs, 10, 140) * weights.latency +
    normalizeLower(jitterMs, 2, 45) * weights.jitter
  ) * 100;
}

function mergeRows(rows: AggregateRow[]): AggregateRow {
  const totalSamples = rows.reduce((sum, row) => sum + row.sample_count, 0);
  const weighted = (field: keyof AggregateRow) => {
    const usable = rows.filter((row) => typeof row[field] === 'number');
    const weightTotal = usable.reduce((sum, row) => sum + row.sample_count, 0);
    if (!weightTotal) return null;
    return usable.reduce((sum, row) => sum + (row[field] as number) * row.sample_count, 0) / weightTotal;
  };
  const names = new Map<string, number>();
  for (const row of rows) {
    if (row.isp_name) names.set(row.isp_name, (names.get(row.isp_name) ?? 0) + row.sample_count);
  }
  const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const first = rows[0];

  return {
    district: 'Kerala',
    asn: first.asn,
    isp_name: name,
    connection_type: 'all',
    sample_count: totalSamples,
    p50_download_mbps: weighted('p50_download_mbps'),
    p90_download_mbps: weighted('p90_download_mbps'),
    p50_upload_mbps: weighted('p50_upload_mbps'),
    p90_upload_mbps: weighted('p90_upload_mbps'),
    p50_latency_ms: weighted('p50_latency_ms'),
    p50_jitter_ms: weighted('p50_jitter_ms'),
  };
}

function normalizeHigher(value: number | null, floor: number, excellent: number): number {
  if (value == null) return 0;
  return clamp((value - floor) / (excellent - floor), 0, 1);
}

function normalizeLower(value: number | null, excellent: number, poor: number): number {
  if (value == null) return 0.45;
  return clamp((poor - value) / (poor - excellent), 0, 1);
}

function sampleConfidence(samples: number): number {
  return clamp(Math.sqrt(samples / 25), 0, 1);
}

function gradeForScore(score: number, samples: number): ScoredNetwork['grade'] {
  if (samples < 3) return 'Needs data';
  if (score >= 85) return 'Elite';
  if (score >= 72) return 'Great';
  if (score >= 58) return 'Good';
  return 'Fair';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
