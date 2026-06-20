import { Landmark } from 'lucide-react';
import type { TraiBenchmark } from '@/lib/localityData';

function fmt(value: number | null): string {
  if (value == null) return '—';
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1);
}

/**
 * Official TRAI MySpeed mobile baseline for Kerala.
 *
 * This is THIRD-PARTY reference data — government-published, mobile-only, and
 * Kerala-wide (not specific to this place). It is presented as a clearly labelled
 * benchmark next to (never merged into) netundo's own crowdsourced measurements.
 */
export function TraiBenchmark({ data }: { data: TraiBenchmark }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Landmark className="h-4 w-4 text-gray-400" />
          Official mobile baseline for Kerala
        </h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Government reference — TRAI&apos;s state-wide mobile average, not netundo-measured data for this area.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Operator</th>
              <th className="px-4 py-2 font-medium">Network</th>
              <th className="px-4 py-2 text-right font-medium">Download</th>
              <th className="px-4 py-2 text-right font-medium">Upload</th>
            </tr>
          </thead>
          <tbody>
            {data.operators.map((op) => (
              <tr key={op.operator} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 font-semibold text-gray-900">{op.operator}</td>
                <td className="px-4 py-2.5 text-gray-500">{op.technology}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                  {fmt(op.downloadMbps)} <span className="text-xs font-normal text-gray-400">Mbps</span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {fmt(op.uploadMbps)} <span className="text-xs font-normal text-gray-400">Mbps</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400">
        Source: {data.source}, {data.periodLabel}. Released under NDSAP. State-level mobile (3G/4G/5G)
        averages; shown for comparison with netundo&apos;s crowdsourced local results above.
      </p>
    </section>
  );
}
