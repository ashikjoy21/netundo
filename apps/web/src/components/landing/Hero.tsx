'use client';

import { useEffect, useState } from 'react';
import { Gauge, MapPin, Activity, Building2, Map as MapIcon } from 'lucide-react';

interface AggRow {
  district: string;
  asn: number | null;
  isp_name: string | null;
  sample_count: number;
}

export function Hero() {
  const [stats, setStats] = useState<{ tests: number; isps: number } | null>(null);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) return;
    fetch(`${apiBase}/v1/aggregate?period=monthly`)
      .then((r) => r.json())
      .then((rows: AggRow[]) => {
        if (!Array.isArray(rows)) return;
        const tests = rows.reduce((a, r) => a + (r.sample_count ?? 0), 0);
        const isps = new Set(rows.map((r) => r.asn ?? r.isp_name).filter(Boolean)).size;
        setStats({ tests, isps });
      })
      .catch(() => {});
  }, []);

  return (
    <section className="px-4 pt-6">
      <div className="relative max-w-6xl mx-auto overflow-hidden rounded-3xl bg-gradient-to-b from-cf-orange to-cf-orange-dark">
        {/* warm glow at the bottom, echoing Cloudflare's hero horizon */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 left-1/2 h-64 w-[120%] -translate-x-1/2 rounded-[100%] bg-orange-200/50 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative px-6 py-16 sm:py-20 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur">
            <MapPin className="h-3.5 w-3.5" /> Kerala's open speed test
          </span>

          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl">
            Know your real internet speed in&nbsp;Kerala
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-base text-white/85 sm:text-lg">
            Crowdsourced, Cloudflare-accurate speed tests mapping every ISP across all 14 districts.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/test"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-cf-orange-dark shadow-sm transition-transform hover:scale-[1.03]"
            >
              <Gauge className="h-4 w-4" /> Test My Speed
            </a>
            <a
              href="#map"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/40 transition-colors hover:bg-white/10"
            >
              <MapIcon className="h-4 w-4" /> Explore the map
            </a>
          </div>

          {/* live counters */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/90">
            <Counter icon={<Activity className="h-4 w-4" />} value={stats ? formatCount(stats.tests) : '—'} label="tests run" />
            <span className="hidden h-4 w-px bg-white/25 sm:block" />
            <Counter icon={<Building2 className="h-4 w-4" />} value={stats ? String(stats.isps) : '—'} label="ISPs tracked" />
            <span className="hidden h-4 w-px bg-white/25 sm:block" />
            <Counter icon={<MapPin className="h-4 w-4" />} value="14" label="districts" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Counter({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      <span className="font-semibold text-white">{value}</span>
      <span className="text-white/70">{label}</span>
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
