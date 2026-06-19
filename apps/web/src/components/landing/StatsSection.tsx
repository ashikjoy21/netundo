'use client';

import { useEffect, useMemo, useState } from 'react';
import { Trophy, Gauge } from 'lucide-react';

interface AggRow {
  district: string;
  asn: number | null;
  isp_name: string | null;
  connection_type: string;
  sample_count: number;
  p50_download_mbps: number | null;
  p90_download_mbps: number | null;
  p50_latency_ms: number | null;
}

export function StatsSection() {
  const [rows, setRows] = useState<AggRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) {
      setLoading(false);
      return;
    }
    fetch(`${apiBase}/v1/aggregate?period=monthly`)
      .then((r) => r.json())
      .then((data: AggRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Fastest districts by best p90 download.
  const districts = useMemo(() => {
    const byDistrict = new Map<string, { best: number; samples: number; latency: number[] }>();
    for (const r of rows) {
      const cur = byDistrict.get(r.district) ?? { best: 0, samples: 0, latency: [] };
      cur.best = Math.max(cur.best, r.p90_download_mbps ?? 0);
      cur.samples += r.sample_count;
      if (r.p50_latency_ms != null) cur.latency.push(r.p50_latency_ms);
      byDistrict.set(r.district, cur);
    }
    return [...byDistrict.entries()]
      .map(([district, v]) => ({
        district,
        best: v.best,
        samples: v.samples,
        latency: v.latency.length ? v.latency.reduce((a, b) => a + b, 0) / v.latency.length : null,
      }))
      .sort((a, b) => b.best - a.best)
      .slice(0, 6);
  }, [rows]);

  // Top ISPs statewide by median download (grouped by ASN).
  const isps = useMemo(() => {
    const byIsp = new Map<string, { name: string; downloads: number[]; samples: number }>();
    for (const r of rows) {
      const key = String(r.asn ?? r.isp_name ?? 'unknown');
      const cur = byIsp.get(key) ?? { name: r.isp_name ?? 'Unknown ISP', samples: 0, downloads: [] };
      if (r.isp_name) cur.name = r.isp_name;
      if (r.p50_download_mbps != null) cur.downloads.push(r.p50_download_mbps);
      cur.samples += r.sample_count;
      byIsp.set(key, cur);
    }
    return [...byIsp.values()]
      .map((v) => ({
        name: v.name,
        samples: v.samples,
        median: v.downloads.length ? v.downloads.reduce((a, b) => a + b, 0) / v.downloads.length : 0,
      }))
      .sort((a, b) => b.median - a.median)
      .slice(0, 5);
  }, [rows]);

  const hasData = rows.length > 0;

  return (
    <section className="grid gap-8 lg:grid-cols-2">
      {/* Fastest districts */}
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Gauge className="h-5 w-5 text-cf-orange" /> Fastest districts
        </h2>
        <p className="mt-1 text-sm text-gray-500">Best download speed recorded this month.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))
          ) : hasData ? (
            districts.map((d) => (
              <div key={d.district} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{d.district}</p>
                <p className={`mt-1 text-2xl font-bold ${speedColor(d.best)}`}>
                  {d.best.toFixed(0)}
                  <span className="ml-0.5 text-xs font-normal text-gray-400">Mbps</span>
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {d.latency != null ? `${d.latency.toFixed(0)}ms · ` : ''}
                  {d.samples} tests
                </p>
              </div>
            ))
          ) : (
            <EmptyHint />
          )}
        </div>
      </div>

      {/* Top ISPs */}
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Trophy className="h-5 w-5 text-cf-orange" /> Top ISPs in Kerala
        </h2>
        <p className="mt-1 text-sm text-gray-500">Ranked by median download speed.</p>

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading ? (
            <div className="h-48 animate-pulse bg-gray-50" />
          ) : hasData ? (
            <ul className="divide-y divide-gray-100">
              {isps.map((isp, i) => (
                <li key={isp.name} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cf-orange/10 text-xs font-semibold text-cf-orange">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-gray-800">{isp.name}</span>
                  <span className="text-xs text-gray-400">{isp.samples} tests</span>
                  <span className={`w-20 text-right text-sm font-semibold ${speedColor(isp.median)}`}>
                    {isp.median.toFixed(0)} Mbps
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6">
              <EmptyHint />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function speedColor(v: number): string {
  if (v >= 50) return 'text-cf-green';
  if (v >= 20) return 'text-yellow-600';
  return 'text-cf-red';
}

function EmptyHint() {
  return (
    <div className="col-span-full rounded-xl border border-dashed border-gray-200 p-6 text-center">
      <p className="text-sm text-gray-400">No data yet — be the first to test in your district.</p>
      <a href="/test" className="mt-2 inline-block text-sm font-medium text-cf-orange hover:underline">
        Run a speed test →
      </a>
    </div>
  );
}
