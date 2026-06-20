'use client';

import { useState, useEffect } from 'react';
import { SpeedMap } from '@/components/landing/SpeedMap';
import { slugify } from '@/lib/slug';

const DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram',
  'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
];

interface AggRow {
  district: string;
  isp_name: string;
  connection_type: string;
  sample_count: number;
  p50_download_mbps: number;
  p90_download_mbps: number;
  p50_latency_ms: number;
}

export default function KeralaPage() {
  const [data, setData] = useState<AggRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedConn, setSelectedConn] = useState('');

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) { setLoading(false); return; }

    const params = new URLSearchParams();
    if (selectedDistrict) params.set('district', selectedDistrict);
    if (selectedConn) params.set('connection_type', selectedConn);

    fetch(`${apiBase}/v1/aggregate?${params}`)
      .then((r) => r.json())
      .then((rows: AggRow[]) => { setData(rows); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedDistrict, selectedConn]);

  // Group by district, pick best ISP row per district for the summary
  const districtSummary = DISTRICTS.map((d) => {
    const rows = data.filter((r) => r.district === d);
    const total = rows.reduce((a, r) => a + r.sample_count, 0);
    const bestDown = rows.length
      ? Math.max(...rows.map((r) => r.p90_download_mbps ?? 0))
      : null;
    const avgLatency = rows.length
      ? rows.reduce((a, r) => a + (r.p50_latency_ms ?? 0), 0) / rows.length
      : null;
    return { district: d, total, bestDown, avgLatency, rows };
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kerala Network Quality Map</h1>
        <p className="text-gray-500 text-sm mt-1">
          Rounded map pins and district-level results from public netundo speed tests.
        </p>
      </div>

      <SpeedMap />

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">District-wise performance</h2>
          <p className="mt-1 text-sm text-gray-500">
            Compare speed, latency, providers, and sample counts after exploring the live map.
          </p>
        </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={selectedDistrict}
          onChange={(e) => setSelectedDistrict(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
        >
          <option value="">All districts</option>
          {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select
          value={selectedConn}
          onChange={(e) => setSelectedConn(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
        >
          <option value="">All connections</option>
          <option value="mobile">Mobile data</option>
          <option value="wifi">Wi-Fi</option>
          <option value="wired">Wired</option>
        </select>
      </div>

      {/* District grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {districtSummary.map(({ district, total, bestDown, avgLatency }) => (
            <DistrictCard
              key={district}
              district={district}
              samples={total}
              downloadMbps={bestDown}
              latencyMs={avgLatency}
            />
          ))}
        </div>
      )}
      </section>

      {/* ISP table */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">ISP Performance by District</h2>
        {loading ? (
          <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
        ) : data.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['District', 'ISP', 'Type', 'Samples', 'P50 Download', 'P90 Download', 'P50 Latency'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{row.district}</td>
                    <td className="px-4 py-3 text-gray-600">{row.isp_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 capitalize">
                        {row.connection_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.sample_count}</td>
                    <td className="px-4 py-3 font-semibold text-cf-orange">{row.p50_download_mbps?.toFixed(1) ?? '—'} Mbps</td>
                    <td className="px-4 py-3 text-gray-600">{row.p90_download_mbps?.toFixed(1) ?? '—'} Mbps</td>
                    <td className="px-4 py-3 text-gray-600">{row.p50_latency_ms?.toFixed(1) ?? '—'} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CTA */}
      <div className="bg-cf-orange/5 border border-cf-orange/20 rounded-xl p-5 flex flex-col md:flex-row items-center gap-4">
        <div className="flex-1">
          <p className="font-semibold text-gray-800">Help fill the map</p>
          <p className="text-sm text-gray-500 mt-0.5">
            Some districts have few samples. Run a test and add your measurement.
          </p>
        </div>
        <a
          href="/test"
          className="shrink-0 px-5 py-2.5 rounded-lg bg-cf-orange text-white text-sm font-semibold hover:bg-cf-orange-dark transition-colors"
        >
          Run Speed Test
        </a>
      </div>
    </div>
  );
}

function DistrictCard({
  district, samples, downloadMbps, latencyMs,
}: {
  district: string;
  samples: number;
  downloadMbps: number | null;
  latencyMs: number | null;
}) {
  const speedColor = downloadMbps == null
    ? 'text-gray-400'
    : downloadMbps >= 50 ? 'text-green-600'
    : downloadMbps >= 20 ? 'text-yellow-600'
    : 'text-red-500';

  return (
    <a
      href={`/kerala/${slugify(district)}`}
      className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm hover:border-cf-orange/40 transition-all"
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">{district}</p>
      <p className={`text-2xl font-bold mt-1 ${speedColor}`}>
        {downloadMbps != null ? `${downloadMbps.toFixed(0)}` : '—'}
        {downloadMbps != null && <span className="text-sm font-normal text-gray-400 ml-0.5">Mbps</span>}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {latencyMs != null ? `${latencyMs.toFixed(0)}ms latency · ` : ''}
        {samples > 0 ? `${samples} tests` : 'No data yet'}
      </p>
    </a>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 border border-gray-200 rounded-xl">
      <p className="text-gray-400 text-sm">No data yet — be the first to test in Kerala!</p>
      <a href="/test" className="mt-3 inline-block text-cf-orange text-sm font-medium hover:underline">
        Run a speed test →
      </a>
    </div>
  );
}
