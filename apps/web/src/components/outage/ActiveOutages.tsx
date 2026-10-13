'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle } from 'lucide-react';
import { outageHeadline, slugifyPlace, statusPath } from '@netundo/types';
import { API_BASE } from '@/lib/api';
import { shareOrWhatsapp } from '@/lib/share';
import type { StatusGroup } from './RightNow';

/** Homepage list of every live "Likely outage" across Kerala. */
export function ActiveOutages() {
  const [outages, setOutages] = useState<StatusGroup[] | null>(null);
  const [windowMin, setWindowMin] = useState(30);

  useEffect(() => {
    if (!API_BASE) {
      setOutages([]);
      return;
    }
    const load = () =>
      fetch(`${API_BASE}/v1/outages/active`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((body: { outages: StatusGroup[]; window_min: number }) => {
          setOutages(body.outages ?? []);
          setWindowMin(body.window_min ?? 30);
        })
        .catch(() => setOutages((prev) => prev ?? []));
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section aria-labelledby="active-outages" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="active-outages" className="text-lg font-bold text-gray-950">
          Likely outages right now
        </h2>
        <a href="/kerala" className="text-sm font-semibold text-cf-orange hover:underline">
          Check your area →
        </a>
      </div>

      {outages == null ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : outages.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> No likely outages reported in Kerala right now.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-red-100">
          {outages.map((o) => {
            const place = o.top_village ?? o.taluk;
            const headline = outageHeadline({
              reporters: o.recent_reporters || o.reporters,
              provider: o.provider,
              place,
              status: o.status,
              windowMin,
            });
            const path = statusPath(o.district, o.taluk, o.brand_key, o.kind);
            return (
              <li key={`${o.district}-${o.taluk}-${o.brand_key}-${o.kind}`} className="flex items-start justify-between gap-3 bg-red-50/60 p-3">
                <a href={`/kerala/${slugifyPlace(o.district)}/${slugifyPlace(o.taluk)}#right-now`} className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-bold text-gray-950">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    {o.provider} · {place}
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {o.kind === 'broadband' ? 'Home broadband' : 'Mobile data'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-gray-700">{headline}</p>
                  <p className="text-xs text-gray-500">
                    {o.taluk}, {o.district}
                  </p>
                </a>
                <button
                  type="button"
                  onClick={() => shareOrWhatsapp(`${headline}. Is it down for you too?`, path)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white"
                  aria-label={`Share ${o.provider} outage on WhatsApp`}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Share
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
