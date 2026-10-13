'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, Gamepad2, Headphones, Play, Search, Trophy, Wifi } from 'lucide-react';
import {
  formatKind,
  groupIspScores,
  pickChartLeader,
  USE_CASES,
  type AggregateRow,
  type ConnectionKind,
  type ScoredNetwork,
  type UseCase,
} from '@/lib/networkScore';
import { API_BASE, fetchBrandAggregates, type AggregatePeriod } from '@/lib/api';
import { RANK_MIN_TESTS } from '@/lib/config';
import { KindToggle } from '@/components/KindToggle';

const PERIOD_LABELS: Record<AggregatePeriod, string> = {
  weekly: 'last 7 days',
  monthly: 'last 28 days',
  quarter: 'last 90 days',
  all: 'all tests so far',
};

interface ChartData {
  rows: AggregateRow[];
  period: AggregatePeriod;
  /** True when the chosen district had no data and we fell back to Kerala-wide. */
  keralaFallback: boolean;
}

/** Widen the time window (28 days → 90 days → all time), then the area
 *  (district → Kerala), until there is something to show. */
async function loadChartData(district: string, kind: ConnectionKind): Promise<ChartData> {
  const periods: AggregatePeriod[] = ['monthly', 'quarter', 'all'];
  for (const period of periods) {
    const rows = await fetchBrandAggregates({ period, district: district || undefined, kind });
    if (rows.length) return { rows, period, keralaFallback: false };
  }
  if (district) {
    const rows = await fetchBrandAggregates({ period: 'all', kind });
    return { rows, period: 'all', keralaFallback: true };
  }
  return { rows: [], period: 'all', keralaFallback: false };
}

const DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram',
  'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
];

export default function ChartsPage() {
  const [data, setData] = useState<ChartData>({ rows: [], period: 'monthly', keralaFallback: false });
  const [loading, setLoading] = useState(true);
  const [district, setDistrict] = useState('');
  const [kind, setKind] = useState<ConnectionKind>('broadband');
  const [useCase, setUseCase] = useState<UseCase>('overall');
  const [query, setQuery] = useState('');

  // Remember the broadband/mobile choice in the URL (?kind=mobile) without
  // changing the page's path.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('kind');
    if (fromUrl === 'mobile') setKind('mobile');
  }, []);

  const chooseKind = (next: ConnectionKind) => {
    setKind(next);
    const url = new URL(window.location.href);
    if (next === 'broadband') url.searchParams.delete('kind');
    else url.searchParams.set('kind', next);
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    if (!API_BASE) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadChartData(district, kind).then((next) => {
      if (cancelled) return;
      setData(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [district, kind]);

  const { ranked, early } = useMemo(() => {
    const scored = groupIspScores(data.rows, useCase);
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? scored.filter((row) => `${row.name} ${row.district} ${row.asns.join(' ')}`.toLowerCase().includes(needle))
      : scored;
    // Networks below the confidence threshold are still shown, but separately
    // and clearly badged, never mixed into the ranked list.
    return {
      ranked: matching.filter((row) => row.samples >= RANK_MIN_TESTS),
      early: matching.filter((row) => row.samples < RANK_MIN_TESTS).sort((a, b) => b.samples - a.samples || b.score - a.score),
    };
  }, [query, data.rows, useCase]);

  const selectedUseCase = USE_CASES.find((item) => item.id === useCase) ?? USE_CASES[0];
  const leader = pickChartLeader(ranked) ?? pickChartLeader(early);
  const leaderIsEarly = leader != null && leader.samples < RANK_MIN_TESTS;
  const scopeLabel = district && !data.keralaFallback ? district : 'Kerala-wide';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <section className="relative overflow-hidden rounded-[1.35rem] bg-neutral-950 px-6 py-10 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:px-10">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(circle at 18% 10%, rgba(246,130,31,0.55), transparent 30%), radial-gradient(circle at 88% 0%, rgba(255,255,255,0.18), transparent 28%)',
          }}
        />
        <div className="relative max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-orange-100">
            <Trophy className="h-3.5 w-3.5" />
            Kerala top charts
          </p>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">
            Find the best ISP for how you actually use the internet.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-white/68 sm:text-base">
            netundo score blends download, upload, latency, jitter, and sample confidence — low-confidence networks are penalised so one-off tests do not top the chart. Choose a use case to re-rank.
          </p>
        </div>
      </section>

      <div className="mt-6">
        <KindToggle value={kind} onChange={chooseKind} />
      </div>

      <section className="mt-3 grid gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm lg:grid-cols-[1fr_auto_auto]">
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ISP, district, or ASN"
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </label>
        <select
          value={district}
          onChange={(event) => setDistrict(event.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-cf-orange"
        >
          <option value="">All Kerala</option>
          {DISTRICTS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select
          value={useCase}
          onChange={(event) => setUseCase(event.target.value as UseCase)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-cf-orange"
        >
          {USE_CASES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.4fr]">
        <aside className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cf-orange">{selectedUseCase.shortLabel} leader</p>
            {leader ? (
              <div className="mt-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-[-0.04em] text-gray-950">{leader.name}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {scopeLabel} · {formatKind(leader.kind)}
                    </p>
                    {leaderIsEarly && <EarlyBadge samples={leader.samples} className="mt-2" />}
                  </div>
                  <ScoreBadge score={leader.score} />
                </div>
                <MetricGrid row={leader} />
              </div>
            ) : loading ? (
              <div className="mt-4 h-24 animate-pulse rounded-xl bg-gray-100" />
            ) : (
              <EmptyCta kind={kind} />
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-orange-50/60 p-5">
            <h3 className="text-sm font-bold text-gray-900">How the score works</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">{selectedUseCase.description}</p>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              Cloudflare&apos;s engine provides AIM scores for individual tests after completion. These public charts use the stored aggregate metrics to estimate a comparable 0-100 netundo score across districts and ISPs.
            </p>
          </div>
        </aside>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <h2 className="font-bold text-gray-950">
              Top {formatKind(kind).toLowerCase()} networks · {scopeLabel}
            </h2>
            {!loading && (
              <span className="text-xs text-gray-500">Data from {PERIOD_LABELS[data.period]}</span>
            )}
          </div>
          {!loading && data.keralaFallback && (
            <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              No {formatKind(kind).toLowerCase()} tests from {district} yet — showing Kerala-wide results instead.
            </p>
          )}
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : ranked.length || early.length ? (
            <>
              {ranked.length > 0 && (
                <ol className="divide-y divide-gray-100">
                  {ranked.slice(0, 50).map((row, index) => (
                    <ChartRow key={row.key} row={row} rank={index + 1} scopeLabel={scopeLabel} />
                  ))}
                </ol>
              )}
              {early.length > 0 && (
                <div className={ranked.length ? 'border-t border-gray-200' : ''}>
                  <div className="bg-gray-50 px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      Early data <EarlyBadge />
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Fewer than {RANK_MIN_TESTS} tests each, so these aren&apos;t ranked yet. Treat the numbers as a first look, not a verdict.
                    </p>
                  </div>
                  <ol className="divide-y divide-gray-100">
                    {early.slice(0, 30).map((row) => (
                      <ChartRow key={row.key} row={row} scopeLabel={scopeLabel} />
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : query.trim() ? (
            <p className="p-10 text-center text-sm text-gray-500">No networks match “{query.trim()}”.</p>
          ) : (
            <div className="p-6">
              <EmptyCta kind={kind} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EarlyBadge({ samples, className = '' }: { samples?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ${className}`}>
      Low confidence{samples != null ? ` · ${samples} test${samples === 1 ? '' : 's'}` : ''}
    </span>
  );
}

/** Shown only if there are no tests of this kind anywhere in Kerala. */
function EmptyCta({ kind }: { kind: ConnectionKind }) {
  return (
    <div className="rounded-xl bg-orange-50 p-5 text-center">
      <p className="text-sm font-semibold text-gray-900">Be the first to put {formatKind(kind).toLowerCase()} on the chart</p>
      <p className="mt-1 text-sm text-gray-600">A 30-second test from your connection starts the ranking.</p>
      <a href="/test" className="mt-3 inline-block rounded-full bg-cf-orange px-4 py-2 text-sm font-semibold text-white hover:bg-cf-orange-dark">
        Run a speed test
      </a>
    </div>
  );
}

function ChartRow({ row, rank, scopeLabel }: { row: ScoredNetwork; rank?: number; scopeLabel: string }) {
  return (
    <li className="grid gap-4 px-4 py-4 transition-colors hover:bg-gray-50 sm:grid-cols-[2rem_1fr_auto] sm:items-center">
      <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${rank != null && rank <= 3 ? 'bg-cf-orange text-white' : 'bg-gray-100 text-gray-500'}`}>
        {rank ?? '·'}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-bold text-gray-950">{row.name}</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {formatKind(row.kind)}
          </span>
          {row.asns.length > 0 && (
            <span className="text-xs text-gray-400">AS{row.asns.slice(0, 3).join(', AS')}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {row.samples} test{row.samples === 1 ? '' : 's'} · {scopeLabel} · Best for {USE_CASES.find((item) => item.id === row.bestFor)?.shortLabel}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 sm:grid-cols-4">
          <MiniMetric icon={<ArrowDownUp className="h-3.5 w-3.5" />} label="Down" value={`${row.downloadMbps?.toFixed(0) ?? '—'} Mbps`} />
          <MiniMetric icon={<Wifi className="h-3.5 w-3.5" />} label="Up" value={`${row.uploadMbps?.toFixed(0) ?? '—'} Mbps`} />
          <MiniMetric icon={<Activity className="h-3.5 w-3.5" />} label="Latency" value={`${row.latencyMs?.toFixed(0) ?? '—'} ms`} />
          <MiniMetric icon={<Headphones className="h-3.5 w-3.5" />} label="Jitter" value={`${row.jitterMs?.toFixed(0) ?? '—'} ms`} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <ScoreBadge score={row.score} />
        <p className="mt-1 text-xs text-gray-400">{row.grade} · {(row.confidence * 100).toFixed(0)}% confidence</p>
      </div>
    </li>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-black ${scoreBadgeClass(score)}`}>
      {score.toFixed(0)}
    </span>
  );
}

function MetricGrid({ row }: { row: ScoredNetwork }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <Metric label="Download" value={`${row.downloadMbps?.toFixed(1) ?? '—'} Mbps`} />
      <Metric label="Upload" value={`${row.uploadMbps?.toFixed(1) ?? '—'} Mbps`} />
      <Metric label="Latency" value={`${row.latencyMs?.toFixed(1) ?? '—'} ms`} />
      <Metric label="Jitter" value={`${row.jitterMs?.toFixed(1) ?? '—'} ms`} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 font-bold text-gray-900">{value}</p>
    </div>
  );
}

function MiniMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1">
      {icon}
      <span>{label}</span>
      <span className="font-semibold text-gray-700">{value}</span>
    </span>
  );
}

function scoreBadgeClass(score: number): string {
  if (score >= 85) return 'bg-emerald-500 text-white';
  if (score >= 72) return 'bg-cf-green/15 text-green-700';
  if (score >= 58) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-50 text-red-600';
}
