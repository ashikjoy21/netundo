import { formatConnectionType, type ScoredNetwork } from '@/lib/networkScore';

const GRADE_STYLE: Record<ScoredNetwork['grade'], string> = {
  Elite: 'bg-green-100 text-green-700',
  Great: 'bg-emerald-50 text-emerald-700',
  Good: 'bg-yellow-50 text-yellow-700',
  Fair: 'bg-orange-50 text-orange-700',
  'Needs data': 'bg-gray-100 text-gray-500',
};

export function IspTable({ isps, placeName }: { isps: ScoredNetwork[]; placeName: string }) {
  if (isps.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
        No provider data for {placeName} yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {['#', 'Provider', 'Type', 'Download', 'Latency', 'Tests', 'Grade'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isps.map((isp, i) => (
            <tr key={isp.key} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-400">{i + 1}</td>
              <td className="px-4 py-3 font-medium text-gray-800">{isp.name}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                  {formatConnectionType(isp.connectionType)}
                </span>
              </td>
              <td className="px-4 py-3 font-semibold text-cf-orange">
                {isp.downloadMbps != null ? `${isp.downloadMbps.toFixed(1)} Mbps` : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {isp.latencyMs != null ? `${isp.latencyMs.toFixed(0)} ms` : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">{isp.samples}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${GRADE_STYLE[isp.grade]}`}>
                  {isp.grade}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
