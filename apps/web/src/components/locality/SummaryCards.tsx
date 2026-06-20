import { Radio, Wifi } from 'lucide-react';
import type { MetricSummary } from '@/lib/localityData';

function metric(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return value >= 100 ? Math.round(value).toString() : value.toFixed(digits);
}

function Card({
  icon,
  title,
  subtitle,
  summary,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  summary: MetricSummary;
}) {
  const hasData = summary.samples > 0 && summary.downloadMbps != null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cf-orange/10 text-cf-orange">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>

      {hasData ? (
        <>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-gray-900">{metric(summary.downloadMbps)}</span>
            <span className="text-sm text-gray-400">Mbps download</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Upload</dt>
              <dd className="text-sm font-semibold text-gray-700">{metric(summary.uploadMbps)}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Latency</dt>
              <dd className="text-sm font-semibold text-gray-700">{metric(summary.latencyMs, 0)} ms</dd>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Tests</dt>
              <dd className="text-sm font-semibold text-gray-700">{summary.samples}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-400">No tests yet — be the first to measure {title.toLowerCase()} here.</p>
      )}
    </div>
  );
}

export function SummaryCards({
  broadband,
  mobile,
  placeName,
}: {
  broadband: MetricSummary;
  mobile: MetricSummary;
  placeName: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card
        icon={<Wifi className="h-4 w-4" />}
        title="Fixed broadband"
        subtitle={`Wi-Fi & wired in ${placeName}`}
        summary={broadband}
      />
      <Card
        icon={<Radio className="h-4 w-4" />}
        title="Mobile data"
        subtitle={`4G / 5G in ${placeName}`}
        summary={mobile}
      />
    </div>
  );
}
