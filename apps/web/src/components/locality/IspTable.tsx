import type { ScoredNetwork } from '@/lib/networkScore';
import type { ProvidersByKind } from '@/lib/localityData';

const GRADE_STYLE: Record<ScoredNetwork['grade'], string> = {
  Elite: 'bg-green-100 text-green-700',
  Great: 'bg-emerald-50 text-emerald-700',
  Good: 'bg-yellow-50 text-yellow-700',
  Fair: 'bg-orange-50 text-orange-700',
  'Needs data': 'bg-gray-100 text-gray-500',
};

/**
 * Provider rankings split into Home broadband and Mobile data tabs. The tabs are
 * plain radio inputs + CSS (no client JS), so the static page stays light and
 * both tables are in the HTML for search engines. Home broadband is the default.
 */
export function IspTable({
  providers,
  placeName,
  id = 'isp',
}: {
  providers: ProvidersByKind;
  placeName: string;
  id?: string;
}) {
  const tabClass =
    'cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:text-gray-900';
  return (
    <div>
      <input type="radio" name={`${id}-kind`} id={`${id}-bb`} className="peer/bb sr-only" defaultChecked />
      <input type="radio" name={`${id}-kind`} id={`${id}-mb`} className="peer/mb sr-only" />
      <div
        role="tablist"
        aria-label="Connection type"
        className="mb-3 inline-flex rounded-full border border-gray-200 bg-white p-1 shadow-sm peer-checked/bb:[&>label:nth-child(1)]:bg-gray-900 peer-checked/bb:[&>label:nth-child(1)]:text-white peer-checked/mb:[&>label:nth-child(2)]:bg-gray-900 peer-checked/mb:[&>label:nth-child(2)]:text-white peer-focus-visible/bb:ring-2 peer-focus-visible/mb:ring-2 ring-cf-orange"
      >
        <label htmlFor={`${id}-bb`} className={tabClass}>
          Home broadband
        </label>
        <label htmlFor={`${id}-mb`} className={tabClass}>
          Mobile data
        </label>
      </div>
      <div className="hidden peer-checked/bb:block">
        <ProviderRows isps={providers.broadband} empty={`No home broadband tests from ${placeName} yet.`} />
      </div>
      <div className="hidden peer-checked/mb:block">
        <ProviderRows isps={providers.mobile} empty={`No mobile data tests from ${placeName} yet.`} />
      </div>
    </div>
  );
}

function ProviderRows({ isps, empty }: { isps: ScoredNetwork[]; empty: string }) {
  if (isps.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
        {empty}{' '}
        <a href="/test" className="font-medium text-cf-orange hover:underline">
          Run a test
        </a>
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {['#', 'Provider', 'Download', 'Latency', 'Tests', 'Grade'].map((h) => (
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
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-cf-orange">
                {isp.downloadMbps != null ? `${isp.downloadMbps.toFixed(1)} Mbps` : '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                {isp.latencyMs != null ? `${isp.latencyMs.toFixed(0)} ms` : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">{isp.samples}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${GRADE_STYLE[isp.grade]}`}>
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
