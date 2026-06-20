import { Gauge } from 'lucide-react';
import type { OoklaBenchmark, OoklaMetric } from '@/lib/localityData';

function fmt(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return value >= 100 ? Math.round(value).toString() : value.toFixed(digits);
}

const quarterLabel = (period: string) => {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  return m ? `Q${m[2]} ${m[1]}` : period;
};

/**
 * Speedtest® by Ookla® Open Data benchmark for a place.
 *
 * THIRD-PARTY CC BY-NC-SA reference (610m tiles, mapped to the area by polygon).
 * Shown as a labelled cross-check next to netundo's own crowdsourced results,
 * never merged. Attribution to Ookla is required by the licence.
 */
export function OoklaBenchmark({ data, placeName }: { data: OoklaBenchmark; placeName: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Gauge className="h-4 w-4 text-gray-400" />
          Speedtest® data for {placeName}
        </h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Independent cross-check from Speedtest® by Ookla® Open Data, {quarterLabel(data.period)} — separate
          from netundo&apos;s own results.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Fixed broadband" metric={data.fixed} />
        <Row label="Mobile" metric={data.mobile} />
      </div>

      <p className="text-[11px] text-gray-400">
        Source: {data.source}. Tiles mapped to {placeName} by area. Licensed CC BY-NC-SA 4.0. Shown for
        comparison with netundo&apos;s crowdsourced local results above.
      </p>
    </section>
  );
}

function Row({ label, metric }: { label: string; metric: OoklaMetric | null }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      {metric ? (
        <>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-bold text-gray-900">{fmt(metric.downloadMbps)}</span>
            <span className="text-xs text-gray-400">Mbps download</span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Upload</dt>
              <dd className="text-sm font-semibold text-gray-700">{fmt(metric.uploadMbps)}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Latency</dt>
              <dd className="text-sm font-semibold text-gray-700">{fmt(metric.latencyMs, 0)} ms</dd>
            </div>
            <div className="rounded-lg bg-gray-50 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Tests</dt>
              <dd className="text-sm font-semibold text-gray-700">{metric.tests.toLocaleString()}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-400">No Ookla data for this area.</p>
      )}
    </div>
  );
}
