'use client';

import { useEffect, useState } from 'react';
import { Trophy, TrendingUp, ArrowRight } from 'lucide-react';
import {
  scoreNetwork,
  formatConnectionType,
  type AggregateRow,
  type ScoredNetwork,
} from '@/lib/networkScore';

interface Props {
  district: string;
  connectionType: string;
  asn: number | null;
  ispName: string | null;
}

// Only show a confident ranking once an area has a meaningful amount of data.
const MIN_NETWORKS = 2;

export function AreaRanking({ district, connectionType, asn, ispName }: Props) {
  const [rows, setRows] = useState<AggregateRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase || !district) {
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ period: 'monthly', district });
    if (connectionType) params.set('connection_type', connectionType);

    setLoading(true);
    fetch(`${apiBase}/v1/aggregate?${params}`)
      .then((r) => r.json())
      .then((data: AggregateRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [district, connectionType]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="h-5 w-48 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 h-10 w-full animate-pulse rounded bg-gray-100" />
      </section>
    );
  }

  const ranked: ScoredNetwork[] = (rows ?? [])
    .map((row) => scoreNetwork(row, 'overall'))
    .sort((a, b) => b.score - a.score || b.samples - a.samples);

  const connLabel = formatConnectionType(connectionType);

  // Too little data to rank honestly — invite the user to seed the area instead.
  if (ranked.length < MIN_NETWORKS) {
    return (
      <section className="rounded-2xl border border-cf-orange/20 bg-cf-orange/5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cf-orange/15 text-cf-orange">
            <TrendingUp className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              You&apos;re early in {district}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              There isn&apos;t enough {connLabel} data here yet to rank networks. Your test just
              added to the map — share netundo with neighbours to build a real picture of {district}.
            </p>
            <a
              href="/charts"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-cf-orange hover:text-cf-orange-dark"
            >
              See Kerala-wide top charts <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </section>
    );
  }

  const index = ranked.findIndex((n) =>
    asn != null ? n.asn === asn : ispName != null && n.name === ispName,
  );
  const mine = index >= 0 ? ranked[index] : null;
  const rank = index >= 0 ? index + 1 : null;
  const total = ranked.length;
  const leader = ranked[0];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">
          How your network ranks in {district}
        </h3>
        <a
          href="/charts"
          className="inline-flex items-center gap-1 text-xs font-semibold text-cf-orange hover:text-cf-orange-dark"
        >
          Full charts <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>

      {mine && rank ? (
        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="text-4xl font-extrabold leading-none text-gray-900">#{rank}</span>
          <span className="mb-0.5 text-sm text-gray-500">of {total} {connLabel} networks</span>
          <span className="mb-0.5 ml-auto rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
            {mine.name} · score {Math.round(mine.score)}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-600">
          We couldn&apos;t match your exact network in {district} yet, but here&apos;s how local
          networks compare. Retest to add your network to the ranking.
        </p>
      )}

      {/* Top 3 leaderboard */}
      <ol className="mt-4 space-y-2">
        {ranked.slice(0, 3).map((n, i) => {
          const isMine = mine != null && n.key === mine.key;
          return (
            <li
              key={n.key}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                isMine ? 'border-cf-orange bg-cf-orange/5' : 'border-gray-100 bg-gray-50/60'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {i === 0 ? <Trophy className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">
                {n.name}
                {isMine && <span className="ml-1.5 text-xs font-semibold text-cf-orange">You</span>}
              </span>
              <span className="shrink-0 text-gray-500">
                {n.downloadMbps != null ? `${n.downloadMbps.toFixed(0)} Mbps` : '—'}
              </span>
              <span className="shrink-0 font-semibold text-gray-700">{Math.round(n.score)}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-xs text-gray-400">
        Ranked by netundo score (download, upload, latency, jitter) from the last 30 days.
        Leader: {leader.name}.
      </p>
    </section>
  );
}
