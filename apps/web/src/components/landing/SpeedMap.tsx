'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed, MapPinned, Loader2 } from 'lucide-react';
import type { SpeedPoint } from './SpeedMapCanvas';

const SpeedMapCanvas = dynamic(() => import('./SpeedMapCanvas'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-gray-100" />,
});

type ConnFilter = 'all' | 'mobile' | 'wifi' | 'wired';

const FILTERS: { id: ConnFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'wired', label: 'Wired' },
];

export function SpeedMap() {
  const [points, setPoints] = useState<SpeedPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ConnFilter>('all');
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) {
      setLoading(false);
      return;
    }
    fetch(`${apiBase}/v1/points`)
      .then((r) => r.json())
      .then((rows: SpeedPoint[]) => setPoints(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? points : points.filter((p) => p.connection_type === filter)),
    [points, filter],
  );

  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc([pos.coords.longitude, pos.coords.latitude]);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <section id="map" className="scroll-mt-16">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <MapPinned className="h-6 w-6 text-cf-orange" /> Live ISP speeds across Kerala
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Each pin is a rounded public test location. Color shows download speed.
          </p>
        </div>
        <button
          onClick={locateMe}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
        >
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-cf-orange" />}
          Use my location
        </button>
      </div>

      {/* Filter chips + legend */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-cf-orange text-white'
                  : 'border border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Legend />
      </div>

      <div className="relative h-[460px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
        <SpeedMapCanvas points={filtered} flyTo={userLoc} />

        {!loading && points.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="pointer-events-auto rounded-xl border border-gray-200 bg-white px-6 py-5 text-center shadow-sm">
              <MapPinned className="mx-auto mb-2 h-6 w-6 text-cf-orange" />
              <p className="text-sm font-medium text-gray-800">No pins on the map yet</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Run a test and opt in to be the first spot in Kerala.
              </p>
              <a
                href="/test"
                className="mt-3 inline-block rounded-full bg-cf-orange px-4 py-2 text-xs font-semibold text-white hover:bg-cf-orange-dark"
              >
                Pin my speed
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend() {
  const items = [
    { c: '#ef4444', label: '< 20' },
    { c: '#f59e0b', label: '20–50' },
    { c: '#22c55e', label: '> 50 Mbps' },
  ];
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: i.c }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
