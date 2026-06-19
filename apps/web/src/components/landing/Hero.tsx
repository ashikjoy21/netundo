'use client';

import { useEffect, useState } from 'react';
import { Activity, Building2, Gauge, MapPin } from 'lucide-react';

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
    <section className="px-1 pt-1 sm:px-2">
      <div className="relative mx-auto min-h-[520px] max-w-[1260px] overflow-hidden rounded-[1.35rem] bg-[#ff4f16] text-white shadow-[0_24px_80px_rgba(124,45,18,0.25)] sm:min-h-[610px]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 103%, rgba(255,246,194,0.92) 0, rgba(255,221,130,0.72) 12%, rgba(255,116,31,0.62) 31%, transparent 53%), linear-gradient(180deg, #ff4618 0%, #ff5a1e 42%, #fb6a18 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16] mix-blend-soft-light"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.85) 1px, transparent 1.4px)',
            backgroundSize: '7px 7px',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white/10 to-transparent"
        />
        <div
          aria-hidden
          className="absolute bottom-[-34px] left-1/2 h-20 w-36 -translate-x-1/2 rounded-[50%] bg-black/30 blur-2xl"
        />
        <div
          aria-hidden
          className="absolute bottom-3 left-1/2 h-2.5 w-8 -translate-x-1/2 rounded-full bg-neutral-800/70"
        />

        <div className="relative mx-auto flex min-h-[520px] max-w-5xl flex-col items-center justify-center px-6 pb-28 pt-24 text-center sm:min-h-[610px]">
          <p className="mb-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            <MapPin className="h-3.5 w-3.5" />
            Kerala network intelligence
          </p>

          <h1 className="max-w-4xl text-balance text-[3rem] font-semibold leading-[0.92] tracking-[-0.065em] text-white sm:text-[4.8rem] lg:text-[5.75rem]">
            Find the best internet
            <br className="hidden sm:block" /> near you
          </h1>

          <p className="mx-auto mt-8 max-w-xl text-balance text-sm font-medium leading-6 text-white/72 sm:text-base">
            Run a quick Cloudflare-powered speed test and help build Kerala&apos;s public map of Wi-Fi, mobile data, and broadband quality.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href="/test"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-neutral-950 shadow-[0_18px_50px_rgba(154,52,18,0.28)] transition duration-200 hover:-translate-y-0.5 hover:bg-orange-50"
            >
              <Gauge className="h-4 w-4 text-cf-orange" />
              Start speed test
            </a>
            <a
              href="#map"
              className="inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white/85 ring-1 ring-white/35 transition duration-200 hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
            >
              Explore Kerala map
            </a>
          </div>

          <div className="absolute inset-x-6 bottom-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs font-medium text-white/75 sm:gap-x-8">
            <Counter icon={<Activity className="h-4 w-4" />} value={stats ? formatCount(stats.tests) : '—'} label="tests run" />
            <span className="hidden h-4 w-px bg-white/25 sm:block" />
            <Counter icon={<Building2 className="h-4 w-4" />} value={stats ? String(stats.isps) : '—'} label="networks tracked" />
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
