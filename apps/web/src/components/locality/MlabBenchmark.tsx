import { Globe2 } from 'lucide-react';
import type { MlabBenchmark } from '@/lib/localityData';

function fmt(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return value >= 100 ? Math.round(value).toString() : value.toFixed(digits);
}

/**
 * Independent M-Lab benchmark for a place.
 *
 * THIRD-PARTY CC0 reference data (single-stream NDT, IP-geolocated to a town).
 * Shown as a clearly labelled comparison next to netundo's own crowdsourced
 * measurements — never merged with them. For hq_town matches we say plainly that
 * the figure is for the taluk's main town, not the whole taluk.
 */
export function MlabBenchmark({
  data,
  placeName,
  geoLevel,
}: {
  data: MlabBenchmark;
  placeName: string;
  geoLevel: 'district' | 'taluk';
}) {
  let descriptor: string;
  if (data.matchType === 'hq_town') {
    descriptor = `independent tests in ${data.mlabLocality}, the main town of ${placeName}`;
  } else if (geoLevel === 'district') {
    descriptor = `independent tests around ${data.mlabLocality}, ${placeName}'s main city`;
  } else {
    descriptor = `independent tests in ${placeName}`;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Globe2 className="h-4 w-4 text-gray-400" />
          Independent measurements (M-Lab)
        </h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Cross-check from {descriptor} — an external public dataset, separate from netundo&apos;s own results.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Download" value={`${fmt(data.downloadMbps)}`} unit="Mbps" emphasis />
        <Stat label="Upload" value={`${fmt(data.uploadMbps)}`} unit="Mbps" />
        <Stat label="Latency" value={`${fmt(data.latencyMs, 0)}`} unit="ms" />
        <Stat label="Tests" value={data.sampleCount.toLocaleString()} unit="" />
      </dl>

      <p className="text-[11px] text-gray-400">
        Source: {data.source}, {data.periodLabel}. Public-domain (CC0) NDT measurements, located by IP to{' '}
        {data.mlabLocality}. Shown for comparison with netundo&apos;s crowdsourced local results above.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis = false,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1">
        <span className={emphasis ? 'text-2xl font-bold text-gray-900' : 'text-lg font-semibold text-gray-700'}>
          {value}
        </span>
        {unit && <span className="ml-1 text-xs text-gray-400">{unit}</span>}
      </dd>
    </div>
  );
}
