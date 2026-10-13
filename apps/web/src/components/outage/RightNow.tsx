'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, RadioTower, Wrench } from 'lucide-react';
import { STATUS_LABELS, outageHeadline, statusPath, type ConnectionKind, type OutageStatusWord } from '@netundo/types';
import { API_BASE } from '@/lib/api';
import { shareOrWhatsapp } from '@/lib/share';
import { ReportButton } from './ReportButton';

export interface StatusGroup {
  district: string;
  taluk: string;
  brand_key: string;
  provider: string;
  kind: ConnectionKind;
  reporters: number;
  recent_reporters: number;
  status: OutageStatusWord;
  top_village: string | null;
  villages: Record<string, number>;
  last_report_at: string;
  likely_outage: boolean;
  outage_started_at: string | null;
}

export interface OperatorUpdate {
  id: string;
  operator: string;
  provider: string;
  status: 'investigating' | 'fixing' | 'restored';
  message: string;
  eta: string | null;
  updated_at: string;
  areas: Array<{ district: string; taluk: string | null }>;
}

interface StatusResponse {
  window_min: number;
  outage_window_min: number;
  groups: StatusGroup[];
  comments: Array<{ provider: string; status: OutageStatusWord; village: string | null; taluk: string; text: string; at: string }>;
  operator_updates: OperatorUpdate[];
}

const OPERATOR_STATUS: Record<OperatorUpdate['status'], { label: string; cls: string }> = {
  investigating: { label: 'Investigating', cls: 'bg-amber-100 text-amber-800' },
  fixing: { label: 'Fixing', cls: 'bg-blue-100 text-blue-800' },
  restored: { label: 'Restored', cls: 'bg-green-100 text-green-800' },
};

function minutesAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

/**
 * Live outage reports for an area (last 60 min), fetched on the client because
 * area pages are static. Refreshes every minute while the tab is visible.
 */
export function RightNow({ district, taluk, village }: { district: string; taluk?: string; village?: string }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!API_BASE) return;
    let cancelled = false;
    const load = async () => {
      const params = new URLSearchParams({ district });
      if (taluk) params.set('taluk', taluk);
      try {
        const res = await fetch(`${API_BASE}/v1/status?${params}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as StatusResponse;
        if (!cancelled) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    // Always load once (even in a background tab); after that, refresh every
    // minute only while the page is visible, and right away when it returns.
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [district, taluk]);

  const place = village ?? taluk ?? district;
  const groups = data?.groups ?? [];
  const updates = data?.operator_updates ?? [];

  return (
    <section id="right-now" className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-950">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          Right now in {place}
        </h2>
        <span className="text-xs text-gray-500">Reports from the last {data?.window_min ?? 60} min</span>
      </div>

      {updates.length > 0 && (
        <ul className="mt-3 space-y-2">
          {updates.map((u) => (
            <li key={u.id} className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-blue-900">
                <Wrench className="h-3.5 w-3.5" /> Update from {u.operator}
                <span className={`rounded-full px-2 py-0.5 ${OPERATOR_STATUS[u.status].cls}`}>{OPERATOR_STATUS[u.status].label}</span>
                <span className="font-normal text-blue-800/80">{minutesAgo(u.updated_at)}</span>
              </p>
              <p className="mt-1 text-sm text-gray-900">{u.message}</p>
              {u.eta && u.status !== 'restored' && (
                <p className="mt-1 text-xs text-gray-600">
                  Expected back by{' '}
                  {new Date(u.eta).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!data && !failed ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : failed && !data ? (
        <p className="mt-3 text-sm text-gray-500">Live reports couldn&apos;t load right now. You can still report a problem.</p>
      ) : groups.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> No problems reported near {place} in the last {data?.window_min ?? 60} minutes.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100">
          {groups.map((g) => (
            <GroupRow key={`${g.taluk}-${g.brand_key}-${g.kind}`} group={g} village={village} showTaluk={!taluk} windowMin={data?.outage_window_min ?? 30} />
          ))}
        </ul>
      )}

      {data && data.comments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {data.comments.slice(0, 4).map((c, i) => (
            <li key={i} className="text-sm text-gray-700">
              <span className="font-semibold">{c.provider}</span>
              <span className="text-gray-400"> · {c.village ?? c.taluk} · {minutesAgo(c.at)}</span>
              <span className="block text-gray-800">“{c.text}”</span>
            </li>
          ))}
        </ul>
      )}

      <ReportButton area={{ district, taluk, village }} size="lg" openOnHash="#report" className="mt-4 w-full" />
    </section>
  );
}

function GroupRow({ group: g, village, showTaluk, windowMin }: { group: StatusGroup; village?: string; showTaluk: boolean; windowMin: number }) {
  const where = g.top_village ?? g.taluk;
  const here = village ? g.villages[village] ?? 0 : null;
  const headline = outageHeadline({
    reporters: g.likely_outage ? g.recent_reporters || g.reporters : g.reporters,
    provider: g.provider,
    place: where,
    status: g.status,
    windowMin: g.likely_outage ? windowMin : 60,
  });
  const path = statusPath(g.district, g.taluk, g.brand_key, g.kind);

  return (
    <li className={`p-3 ${g.likely_outage ? 'bg-red-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-gray-950">{g.provider}</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              {g.kind === 'broadband' ? 'Home broadband' : 'Mobile data'}
            </span>
            {g.likely_outage && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                <AlertTriangle className="h-3 w-3" /> Likely outage
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            <RadioTower className="mr-1 inline h-3.5 w-3.5 text-gray-400" />
            {g.reporters} {g.reporters === 1 ? 'report' : 'reports'} · mostly “{STATUS_LABELS[g.status].en.toLowerCase()}”
            {showTaluk ? ` · ${g.taluk}` : g.top_village ? ` · around ${g.top_village}` : ''}
            {here != null && here > 0 ? ` · ${here} from ${village}` : ''}
          </p>
          <p className="text-xs text-gray-500">Last report {minutesAgo(g.last_report_at)}</p>
        </div>
        <button
          type="button"
          onClick={() => shareOrWhatsapp(`${headline}. Is it down for you too?`, path)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white"
          aria-label={`Share ${g.provider} status on WhatsApp`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> Share
        </button>
      </div>
    </li>
  );
}
