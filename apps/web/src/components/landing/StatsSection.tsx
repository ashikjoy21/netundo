'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Gamepad2, Gauge, Headphones, Play, Trophy } from 'lucide-react';
import {
  formatConnectionType,
  groupIspScores,
  scoreNetwork,
  USE_CASES,
  type AggregateRow,
  type ScoredNetwork,
} from '@/lib/networkScore';

export function StatsSection() {
  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) {
      setLoading(false);
      return;
    }
    fetch(`${apiBase}/v1/aggregate?period=monthly`)
      .then((r) => r.json())
      .then((data: AggregateRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Districts ranked by a Cloudflare-inspired quality score, not raw speed alone.
  const districts = useMemo(() => {
    const byDistrict = new Map<string, AggregateRow[]>();
    for (const r of rows) {
      const bucket = byDistrict.get(r.district);
      if (bucket) bucket.push(r);
      else byDistrict.set(r.district, [r]);
    }

    return [...byDistrict.entries()].map(([district, bucket]) => {
      const samples = bucket.reduce((sum, row) => sum + row.sample_count, 0);
      const bestRow = bucket
        .map((row) => scoreNetwork(row, 'overall'))
        .sort((a, b) => b.score - a.score)[0];
      return { ...bestRow, district, samples };
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [rows]);

  const isps = useMemo(() => {
    return groupIspScores(rows, 'overall').slice(0, 5);
  }, [rows]);

  const useCaseLeaders = useMemo(
    () => USE_CASES.filter((useCase) => useCase.id !== 'overall').slice(0, 3).map((useCase) => ({
      ...useCase,
      leader: groupIspScores(rows, useCase.id)[0] ?? null,
    })),
    [rows],
  );

  const hasData = rows.length > 0;

  return (
    <section className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange">Top charts</p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-gray-950">Best networks by netundo score</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Inspired by Cloudflare AIM scoring: speed, upload, latency, jitter, and sample confidence are blended for each use case.
          </p>
        </div>
        <a href="/charts" className="inline-flex items-center gap-2 text-sm font-semibold text-cf-orange hover:text-cf-orange-dark">
          View full charts <ArrowRight className="h-4 w-4" />
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />
          ))
        ) : hasData ? (
          useCaseLeaders.map((item) => (
            <UseCaseCard key={item.id} icon={useCaseIcon(item.id)} label={item.shortLabel} leader={item.leader} />
          ))
        ) : (
          <div className="md:col-span-3">
            <EmptyHint />
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
      {/* Fastest districts */}
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Gauge className="h-5 w-5 text-cf-orange" /> Fastest districts
        </h2>
        <p className="mt-1 text-sm text-gray-500">Ranked by balanced score, not raw download alone.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))
          ) : hasData ? (
            districts.map((d) => (
              <div key={d.district} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{d.district}</p>
                <p className={`mt-1 text-2xl font-bold ${scoreColor(d.score)}`}>
                  {d.score.toFixed(0)}
                  <span className="ml-0.5 text-xs font-normal text-gray-400">score</span>
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {d.downloadMbps != null ? `${d.downloadMbps.toFixed(0)} Mbps · ` : ''}
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
        <p className="mt-1 text-sm text-gray-500">Ranked by netundo score for real-world quality.</p>

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading ? (
            <div className="h-48 animate-pulse bg-gray-50" />
          ) : hasData ? (
            <ul className="divide-y divide-gray-100">
              {isps.map((isp, i) => (
                <li key={isp.key} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cf-orange/10 text-xs font-semibold text-cf-orange">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800">{isp.name}</span>
                    <span className="text-xs text-gray-400">
                      {isp.downloadMbps?.toFixed(0) ?? '—'} Mbps · {isp.latencyMs?.toFixed(0) ?? '—'} ms · {isp.samples} tests
                    </span>
                  </div>
                  <span className={`w-20 text-right text-sm font-semibold ${scoreColor(isp.score)}`}>
                    {isp.score.toFixed(0)}
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
      </div>
    </section>
  );
}

function UseCaseCard({
  icon,
  label,
  leader,
}: {
  icon: React.ReactNode;
  label: string;
  leader: ScoredNetwork | null;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cf-orange/10 text-cf-orange">
            {icon}
          </span>
          Best for {label}
        </span>
        {leader && <span className={`text-xl font-bold ${scoreColor(leader.score)}`}>{leader.score.toFixed(0)}</span>}
      </div>
      {leader ? (
        <div className="mt-4">
          <p className="truncate text-base font-bold text-gray-950">{leader.name}</p>
          <p className="mt-1 text-xs text-gray-500">
            {leader.downloadMbps?.toFixed(0) ?? '—'} Mbps · {leader.latencyMs?.toFixed(0) ?? '—'} ms · {leader.samples} tests
          </p>
          <p className="mt-2 text-xs font-medium text-cf-orange">{formatConnectionType(leader.connectionType)} network</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-400">Waiting for enough public tests.</p>
      )}
    </div>
  );
}

function useCaseIcon(useCase: string) {
  if (useCase === 'streaming') return <Play className="h-4 w-4" />;
  if (useCase === 'gaming') return <Gamepad2 className="h-4 w-4" />;
  return <Headphones className="h-4 w-4" />;
}

function scoreColor(v: number): string {
  if (v >= 72) return 'text-cf-green';
  if (v >= 58) return 'text-yellow-600';
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
