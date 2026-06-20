'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Cloud, Hash, LocateFixed, MapPin, Pause, Play, RadioTower, RotateCcw, Router, Server, Share2, Wifi } from 'lucide-react';
import { useSpeedTest } from '@/hooks/useSpeedTest';
import { SpeedChart } from './SpeedChart';
import { NetworkQuality } from './NetworkQuality';
import { BoxPlotRow, LatencyBoxPlotRow } from './BoxPlot';
import { DistrictPicker, type ConnectionType, type GeoCoords } from './DistrictPicker';
import { AreaRanking } from './AreaRanking';
import {
  formatMbps,
  formatMs,
  groupBandwidthBySize,
  computeBoxStats,
  niceAxis,
  COLO_LATLNG,
  DISTRICT_LATLNG,
} from '@/lib/utils';

// MapLibre is browser-only — load it client-side with a skeleton fallback.
const ServerLocationMap = dynamic(() => import('./ServerLocationMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-gray-100 rounded-lg animate-pulse" />,
});

type AppState = 'setup' | 'testing' | 'done';

// Measurement provenance tags. Bump CLIENT_VERSION on any change to how the
// test is run or results are derived, so older readings can be filtered later.
// ENGINE_VERSION mirrors the pinned @cloudflare/speedtest dependency — keep in
// sync when that package is upgraded.
const CLIENT_VERSION = 'web-1';
const ENGINE_VERSION = '@cloudflare/speedtest@1.10.1';

/** Coefficient of variation (stddev / mean) of a sample set. null if not computable. */
function coefficientOfVariation(values: number[]): number | undefined {
  const xs = values.filter((v) => typeof v === 'number' && v > 0);
  if (xs.length < 2) return undefined;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return undefined;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

export function SpeedTest() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [district, setDistrict] = useState('');
  const [connType, setConnType] = useState<ConnectionType>('wifi');
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [localArea, setLocalArea] = useState('');
  const [planMbps, setPlanMbps] = useState<number | null>(null);
  const [resultSubmitted, setResultSubmitted] = useState(false);

  const {
    state: { status, summary, scores, downloadPoints, uploadPoints,
      unloadedLatencyPoints, downLoadedLatencyPoints, upLoadedLatencyPoints,
      currentPhase, progress, durationMs, edgeColo, edgeCity, asn, ispName, clientIp, error, profile },
    start,
    pause,
    resume,
    restart,
  } = useSpeedTest();

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isDone = status === 'done';
  const networkLabel = ispName
    ? `${ispName}${asn ? ` (AS${asn})` : ''}`
    : asn
      ? `AS${asn}`
      : 'Not available from this connection';

  const downloadGroups = useMemo(() => groupBandwidthBySize(downloadPoints), [downloadPoints]);
  const uploadGroups = useMemo(() => groupBandwidthBySize(uploadPoints), [uploadPoints]);

  const latencyStats = useMemo(() => computeBoxStats(unloadedLatencyPoints), [unloadedLatencyPoints]);
  const downLoadedLatencyStats = useMemo(() => computeBoxStats(downLoadedLatencyPoints), [downLoadedLatencyPoints]);
  const upLoadedLatencyStats = useMemo(() => computeBoxStats(upLoadedLatencyPoints), [upLoadedLatencyPoints]);

  // Separate "nice" axes per column — like Cloudflare, download and upload get
  // independent scales (so upload boxes aren't crushed by the download scale),
  // and all three latency plots share one scale for easy comparison.
  const latencyAxis = useMemo(() => {
    const all = [...unloadedLatencyPoints, ...downLoadedLatencyPoints, ...upLoadedLatencyPoints];
    return niceAxis(all.length ? Math.max(...all) : 200);
  }, [unloadedLatencyPoints, downLoadedLatencyPoints, upLoadedLatencyPoints]);

  const downloadAxis = useMemo(() => {
    const maxBps = downloadPoints.length ? Math.max(...downloadPoints.map((p) => p.bps)) : 0;
    return niceAxis(maxBps || 250_000_000);
  }, [downloadPoints]);

  const uploadAxis = useMemo(() => {
    const maxBps = uploadPoints.length ? Math.max(...uploadPoints.map((p) => p.bps)) : 0;
    return niceAxis(maxBps || 100_000_000);
  }, [uploadPoints]);

  const handleStart = async (d: string, ct: ConnectionType, c: GeoCoords | null, area: string, plan: number | null) => {
    setDistrict(d);
    setConnType(ct);
    setCoords(c);
    setLocalArea(area);
    setPlanMbps(plan);
    setAppState('testing');
    setResultSubmitted(false);
    await start();
  };

  // Auto-transition to done after React has committed the latest hook state.
  useEffect(() => {
    if (appState !== 'testing' || !isDone) return;
    setAppState('done');
    void submitResult();
    // submitResult reads the final measurement snapshot from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, isDone]);

  async function submitResult() {
    if (resultSubmitted) return;
    setResultSubmitted(true);

    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase || !district) return;

    try {
      const nav = navigator as Navigator & {
        connection?: { effectiveType?: string };
      };

      await fetch(`${apiBase}/v1/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          scores,
          measurement: {
            profile,
            durationMs: durationMs ?? undefined,
            downloadSamples: downloadPoints.length,
            uploadSamples: uploadPoints.length,
            downloadCov: coefficientOfVariation(downloadPoints.map((p) => p.bps)),
            clientVersion: CLIENT_VERSION,
            engineVersion: ENGINE_VERSION,
          },
          client: {
            connectionType: connType,
            effectiveType: nav.connection?.effectiveType,
            userAgent: navigator.userAgent,
          },
          location: coords
            ? { district, taluk: localArea || undefined, lat: coords.lat, lng: coords.lng, accuracyM: coords.accuracyM }
            : { district, taluk: localArea || undefined },
          plan: planMbps ? { advertisedMbps: planMbps } : undefined,
          consent: { sharePublicly: true, shareExactLocation: !!coords },
        }),
      });
    } catch {
      // Non-critical — don't surface to user
    }
  }

  const handleRetest = async () => {
    setAppState('testing');
    setResultSubmitted(false);
    await restart();
  };

  const phaseLabel = useMemo(() => {
    if (!currentPhase) return null;
    const labels: Record<string, string> = {
      latency: 'Measuring latency…',
      latencyUnderLoad: 'Measuring loaded latency…',
      download: 'Measuring download speed…',
      upload: 'Measuring upload speed…',
    };
    return labels[currentPhase] ?? currentPhase;
  }, [currentPhase]);

  // ── Setup screen ──
  if (appState === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Test your internet where you are</h1>
          <p className="text-gray-500 text-sm">Measure your connection and help Kerala compare real local network quality.</p>
        </div>
        <DistrictPicker onConfirm={handleStart} />
      </div>
    );
  }

  // ── Active test + results ──
  return (
    <div className="w-full max-w-5xl mx-auto px-4 pb-12 space-y-6">

      {/* ── Header metrics ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Internet Speed</h2>

        {/* Progress bar — sticky on mobile so it stays visible while charts scroll */}
        {(isRunning || isPaused || isDone) && (
          <div className="sticky top-[4.75rem] z-20 -mx-4 mb-4 border-b border-gray-100 bg-white/95 px-4 pb-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
            <ProgressBar
              progress={isDone ? 1 : progress}
              phaseLabel={phaseLabel}
              status={status}
              durationMs={durationMs}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-6 items-start">
          {/* Download chart */}
          <div className="min-h-[200px]">
            <p className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cf-orange inline-block" />
              Download
              <InfoTooltip text="The speed at which data is transferred from the internet to your device (90th percentile)" />
            </p>
            <div className="h-[200px] relative">
              <SpeedChart
                points={downloadPoints}
                color="#f6821f"
                fillColor="#ffecd9"
                percentile={summary.download}
                currentBps={summary.download}
                label="Download"
              />
            </div>
          </div>

          {/* Upload chart */}
          <div className="min-h-[200px]">
            <p className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cf-purple inline-block" />
              Upload
              <InfoTooltip text="The speed at which data is transferred from your device to the internet (90th percentile)" />
            </p>
            <div className="h-[200px] relative">
              <SpeedChart
                points={uploadPoints}
                color="#7c3aed"
                fillColor="#ede9fe"
                percentile={summary.upload}
                currentBps={summary.upload}
                label="Upload"
              />
            </div>
          </div>

          {/* Right column: Latency / Jitter */}
          <div className="flex flex-col gap-4 min-w-[160px]">
            <MetricStat
              label="Latency"
              value={formatMs(summary.latency)}
              unit="ms"
              sub1={{ label: 'download', value: formatMs(summary.downLoadedLatency), color: '#f6821f' }}
              sub2={{ label: 'upload', value: formatMs(summary.upLoadedLatency), color: '#7c3aed' }}
              tooltip="Unloaded round-trip time to the test server. The sub-values show latency measured while the connection is loaded during download (↓) and upload (↑)."
            />
            <MetricStat
              label="Jitter"
              value={formatMs(summary.jitter)}
              unit="ms"
              sub1={{ label: 'download', value: formatMs(summary.downLoadedJitter), color: '#f6821f' }}
              sub2={{ label: 'upload', value: formatMs(summary.upLoadedJitter), color: '#7c3aed' }}
              tooltip="Variation in latency between consecutive pings. Sub-values show jitter while loaded during download (↓) and upload (↑)."
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {isRunning ? (
            <ActionBtn onClick={pause} icon={<Pause className="h-4 w-4" />} label="Pause" />
          ) : isPaused ? (
            <ActionBtn onClick={resume} icon={<Play className="h-4 w-4" />} label="Resume" />
          ) : null}

          <ActionBtn onClick={handleRetest} icon={<RotateCcw className="h-4 w-4" />} label="Retest" />

          {isDone && (
            <ShareButton
              summary={summary}
              district={district}
              area={localArea}
              connectionType={connType}
              networkLabel={networkLabel}
              planMbps={planMbps}
            />
          )}

          {isDone && (
            <span className="ml-auto text-xs text-gray-400">
              Measured at {new Date().toLocaleTimeString()} · {localArea ? `${localArea}, ` : ''}{district} · {connType}
            </span>
          )}
        </div>
      </section>

      {/* ── Plan vs reality ── */}
      {isDone && planMbps && typeof summary.download === 'number' && (
        <PlanVsReality planMbps={planMbps} downloadMbps={(summary.download as number) / 1_000_000} />
      )}

      {/* ── How your network ranks locally ── */}
      {isDone && district && (
        <AreaRanking district={district} connectionType={connType} asn={asn} ispName={ispName} />
      )}

      {/* ── Network Quality Score ── */}
      <NetworkQuality scores={isDone ? scores : null} />

      {/* ── Two-column detail section ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Server Location */}
        <section className="space-y-3">
          <SectionHeader title="Connection path" />
          <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
            <div className="h-56 rounded-lg overflow-hidden mb-3 bg-gray-100">
              <ServerLocationMap
                client={district ? DISTRICT_LATLNG[district] ?? null : null}
                server={edgeColo ? COLO_LATLNG[edgeColo] ?? null : null}
                clientLabel={district ? `You — ${district}` : 'You'}
                serverLabel={edgeCity ? `Cloudflare ${edgeCity}${edgeColo ? ` (${edgeColo})` : ''}` : 'Cloudflare edge'}
              />
            </div>
            <InfoRow icon={<Cloud />} label="Protocol" value="IPv4" />
            <InfoRow
              icon={<Server />}
              label="Cloudflare edge"
              value={edgeCity ? `${edgeCity}${edgeColo ? ` (${edgeColo})` : ''}` : edgeColo ? `Cloudflare ${edgeColo}` : '—'}
            />
            <InfoRow
              icon={<RadioTower />}
              label="Detected network"
              value={networkLabel}
            />
            <InfoRow icon={<Hash />} label="Client IP" value={clientIp || '—'} />
            <InfoRow icon={<MapPin />} label="District" value={district || '—'} />
            {localArea && <InfoRow icon={<LocateFixed />} label="Area" value={localArea} />}
            <InfoRow icon={connType === 'wired' ? <Router /> : <Wifi />} label="Connection type" value={connType} />
          </div>
        </section>

        {/* Latency Measurements */}
        <section className="space-y-3">
          <SectionHeader title="Latency Measurements" />
          <div className="space-y-2">
            {latencyStats ? (
              <LatencyBoxPlotRow
                label="Unloaded latency"
                count={unloadedLatencyPoints.length}
                stats={latencyStats}
                values={unloadedLatencyPoints}
                maxValue={latencyAxis.max}
                ticks={latencyAxis.ticks}
                color="#f6821f"
              />
            ) : (
              <EmptyBox label="Unloaded latency" />
            )}
            {downLoadedLatencyStats ? (
              <LatencyBoxPlotRow
                label="Latency during download"
                count={downLoadedLatencyPoints.length}
                stats={downLoadedLatencyStats}
                values={downLoadedLatencyPoints}
                maxValue={latencyAxis.max}
                ticks={latencyAxis.ticks}
                color="#f6821f"
              />
            ) : (
              <EmptyBox label="Latency during download" />
            )}
            {upLoadedLatencyStats ? (
              <LatencyBoxPlotRow
                label="Latency during upload"
                count={upLoadedLatencyPoints.length}
                stats={upLoadedLatencyStats}
                values={upLoadedLatencyPoints}
                maxValue={latencyAxis.max}
                ticks={latencyAxis.ticks}
                color="#7c3aed"
              />
            ) : (
              <EmptyBox label="Latency during upload" />
            )}
          </div>
        </section>
      </div>

      {/* ── Download Measurements ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <SectionHeader title="Download Measurements" />
          <div className="space-y-2">
            {downloadGroups.length ? (
              downloadGroups.map((g) => (
                <BoxPlotRow
                  key={g.bytes}
                  label={`${g.label} download test`}
                  count={g.stats.count}
                  stats={g.stats}
                  values={g.values}
                  maxValue={downloadAxis.max}
                  ticks={downloadAxis.ticks}
                  color="#f6821f"
                  unit="bps"
                />
              ))
            ) : (
              ['100kB', '1MB', '10MB', '25MB', '100MB'].map((s) => (
                <EmptyBox key={s} label={`${s} download test`} />
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader title="Upload Measurements" />
          <div className="space-y-2">
            {uploadGroups.length ? (
              uploadGroups.map((g) => (
                <BoxPlotRow
                  key={g.bytes}
                  label={`${g.label} upload test`}
                  count={g.stats.count}
                  stats={g.stats}
                  values={g.values}
                  maxValue={uploadAxis.max}
                  ticks={uploadAxis.ticks}
                  color="#7c3aed"
                  unit="bps"
                />
              ))
            ) : (
              ['100kB', '1MB', '10MB'].map((s) => (
                <EmptyBox key={s} label={`${s} upload test`} />
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Kerala contribution CTA ── */}
      {isDone && (
        <div className="bg-gradient-to-r from-cf-orange/10 to-cf-purple/10 border border-cf-orange/20 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex-1">
            <p className="font-semibold text-gray-800 text-sm">Your data helps Kerala!</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Your result for <strong>{district}</strong> has been anonymously added to the Kerala Network Quality Map.
              {!coords && ' It will count in area/district charts but will not appear as a precise map pin.'}
            </p>
          </div>
          <a
            href="/kerala"
            className="shrink-0 px-4 py-2 rounded-lg bg-cf-orange text-white text-sm font-semibold hover:bg-cf-orange-dark transition-colors"
          >
            View Kerala Map →
          </a>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function ProgressBar({
  progress,
  phaseLabel,
  status,
  durationMs,
}: {
  progress: number;
  phaseLabel: string | null;
  status: string;
  durationMs: number | null;
}) {
  const isDone = status === 'done';
  const isPaused = status === 'paused';
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  const label = isDone
    ? `Test complete${durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}`
    : isPaused
      ? 'Paused'
      : phaseLabel ?? 'Starting…';

  const barColor = isDone ? 'bg-green-500' : isPaused ? 'bg-gray-400' : 'bg-cf-orange';
  const labelColor = isDone ? 'text-green-700' : isPaused ? 'text-gray-500' : 'text-gray-700';
  const fillWidth = pct === 0 ? '0%' : `${Math.max(pct, 3)}%`;

  return (
    <div className="mb-1 sm:mb-4" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`text-sm font-medium flex items-center gap-1.5 min-w-0 ${labelColor}`}>
          {isDone && (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-green-600">
              <circle cx="8" cy="8" r="7" fill="currentColor" />
              <path d="M5 8.2l2 2 4-4.4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {!isDone && !isPaused && <span className="h-2 w-2 shrink-0 rounded-full bg-cf-orange animate-pulse" />}
          <span className="truncate">{label}</span>
        </span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${isDone ? 'text-green-700' : 'text-gray-700'}`}>
          {pct}%
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full border border-gray-200 bg-gray-200/80 shadow-inner sm:h-2.5">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
          style={{ width: fillWidth }}
        />
      </div>
    </div>
  );
}

function MetricStat({
  label, value, unit, sub1, sub2, tooltip,
}: {
  label: string;
  value: string;
  unit: string;
  sub1?: { label: string; value: string; color: string };
  sub2?: { label: string; value: string; color: string };
  tooltip?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-sm text-gray-500">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        <span className="text-sm text-gray-400">{unit}</span>
      </div>
      {(sub1 || sub2) && (
        <div className="flex gap-3 mt-1">
          {sub1 && (
            <span className="text-xs flex items-center gap-1" title={`${sub1.label} loaded`}>
              <span style={{ color: sub1.color }}>↓</span>
              <span className="text-gray-400">{sub1.value} ms</span>
            </span>
          )}
          {sub2 && (
            <span className="text-xs flex items-center gap-1" title={`${sub2.label} loaded`}>
              <span style={{ color: sub2.color }}>↑</span>
              <span className="text-gray-400">{sub2.value} ms</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PlanVsReality({ planMbps, downloadMbps }: { planMbps: number; downloadMbps: number }) {
  const pct = Math.round((downloadMbps / planMbps) * 100);
  const v = planVerdict(pct);
  const barPct = Math.min(100, Math.max(2, pct));

  return (
    <section className={`rounded-2xl border ${v.border} ${v.bg} p-5 sm:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">Are you getting what you pay for?</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v.badge}`}>{v.tag}</span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className={`text-5xl font-extrabold leading-none ${v.text}`}>{pct}%</span>
        <span className="mb-1 text-sm font-medium text-gray-500">of your {planMbps} Mbps plan</span>
      </div>

      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/70 ring-1 ring-inset ring-black/5">
        <div className={`h-full rounded-full ${v.fill} transition-all`} style={{ width: `${barPct}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <span className="text-gray-500">
          Advertised <strong className="text-gray-800">{planMbps} Mbps</strong>
          <span className="mx-2 text-gray-300">·</span>
          Delivered now <strong className="text-gray-800">{downloadMbps.toFixed(1)} Mbps</strong>
        </span>
        <span className={`font-medium ${v.text}`}>{v.message}</span>
      </div>
    </section>
  );
}

function planVerdict(pct: number) {
  if (pct >= 80) {
    return {
      tag: 'On plan',
      message: "You're getting what you pay for.",
      text: 'text-green-700',
      bg: 'bg-green-50',
      border: 'border-green-200',
      badge: 'bg-green-600 text-white',
      fill: 'bg-green-500',
    };
  }
  if (pct >= 50) {
    return {
      tag: 'Below plan',
      message: 'A bit under your advertised speed.',
      text: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      badge: 'bg-amber-500 text-white',
      fill: 'bg-amber-500',
    };
  }
  return {
    tag: 'Underdelivering',
    message: 'Well below what your plan promises.',
    text: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-600 text-white',
    fill: 'bg-red-500',
  };
}

function ActionBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
    >
      <span className="text-cf-orange">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ShareButton({
  summary,
  district,
  area,
  connectionType,
  networkLabel,
  planMbps,
}: {
  summary: Record<string, unknown>;
  district: string;
  area: string;
  connectionType: ConnectionType;
  networkLabel: string;
  planMbps: number | null;
}) {
  const planPct = planMbps && typeof summary.download === 'number'
    ? Math.round(((summary.download as number) / 1_000_000 / planMbps) * 100)
    : null;
  const planDelivery = planPct != null ? `${planPct}% of ${planMbps} Mbps plan` : null;
  const text = `My internet speed in ${area ? `${area}, ` : ''}${district} on ${networkLabel}: ${formatMbps(summary.download as number)} Mbps ↓ ${formatMbps(summary.upload as number)} Mbps ↑ ${formatMs(summary.latency as number)} ms latency${planDelivery ? ` (${planDelivery})` : ''} via netundo.in`;

  return (
    <button
      onClick={async () => {
        const file = await createShareCard({
          downloadMbps: formatMbps(summary.download as number),
          uploadMbps: formatMbps(summary.upload as number),
          latencyMs: formatMs(summary.latency as number),
          jitterMs: formatMs(summary.jitter as number),
          district,
          area,
          connectionType,
          networkLabel,
          planDelivery,
        });

        if (file && navigator.share && canShareFile(file)) {
          navigator.share({ title: 'My netundo speed test', text, files: [file] }).catch(() => {});
          return;
        }

        if (file) {
          downloadFile(file);
          navigator.clipboard?.writeText(text).catch(() => {});
          return;
        }

        if (navigator.share) navigator.share({ title: 'My netundo speed test', text }).catch(() => {});
        else navigator.clipboard.writeText(text).catch(() => {});
      }}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
    >
      <Share2 className="h-4 w-4 text-cf-orange" />
      <span>Share</span>
    </button>
  );
}

async function createShareCard({
  downloadMbps,
  uploadMbps,
  latencyMs,
  jitterMs,
  district,
  area,
  connectionType,
  networkLabel,
  planDelivery,
}: {
  downloadMbps: string;
  uploadMbps: string;
  latencyMs: string;
  jitterMs: string;
  district: string;
  area: string;
  connectionType: ConnectionType;
  networkLabel: string;
  planDelivery: string | null;
}): Promise<File | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const orangeDark = '#ff4f16';
  const ink = '#171d2b';
  const muted = '#64748b';
  const faint = '#94a3b8';

  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';

  const gradient = ctx.createLinearGradient(0, 0, 1200, 675);
  gradient.addColorStop(0, '#ff4618');
  gradient.addColorStop(0.55, '#ff741f');
  gradient.addColorStop(1, '#f6821f');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, 1200, 675, 44);
  ctx.fill();

  const glow = ctx.createRadialGradient(600, 720, 20, 600, 720, 560);
  glow.addColorStop(0, 'rgba(255, 247, 196, 0.9)');
  glow.addColorStop(0.32, 'rgba(255, 221, 130, 0.32)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1200, 675);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let x = 24; x < 1200; x += 18) {
    for (let y = 24; y < 675; y += 18) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const panelX = 70;
  const panelW = 1060;
  const contentX = panelX + 50;
  const contentRight = panelX + panelW - 50;

  ctx.save();
  ctx.shadowColor = 'rgba(120, 40, 0, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = 'white';
  roundRect(ctx, panelX, 80, panelW, 515, 34);
  ctx.fill();
  ctx.restore();

  // Wordmark — measured so "undo" sits flush against "net"
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '-2px';
  ctx.font = '900 46px Inter, system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.fillText('net', contentX, 152);
  const netWidth = ctx.measureText('net').width;
  ctx.fillStyle = orangeDark;
  ctx.fillText('undo', contentX + netWidth + 4, 152);
  ctx.letterSpacing = '0px';

  // "SPEED TEST" eyebrow, right-aligned
  ctx.textAlign = 'right';
  ctx.fillStyle = orangeDark;
  ctx.font = '800 18px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('SPEED TEST', contentRight, 145);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';

  // Location + network
  ctx.fillStyle = muted;
  ctx.font = '600 23px Inter, system-ui, sans-serif';
  ctx.fillText(
    fitCanvasText(ctx, `${area ? `${area}, ` : ''}${district} · ${connectionTypeLabel(connectionType)}`, contentRight - contentX),
    contentX,
    202,
  );
  ctx.fillStyle = faint;
  ctx.font = '600 20px Inter, system-ui, sans-serif';
  ctx.fillText(fitCanvasText(ctx, networkLabel, contentRight - contentX), contentX, 236);

  // Hero download number
  ctx.fillStyle = ink;
  ctx.font = '800 130px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '-2px';
  ctx.fillText(downloadMbps, contentX - 4, 372);
  const dlWidth = ctx.measureText(downloadMbps).width;
  ctx.letterSpacing = '0px';
  ctx.fillStyle = orangeDark;
  ctx.font = '800 30px Inter, system-ui, sans-serif';
  ctx.fillText('Mbps', contentX + dlWidth + 14, 372);
  ctx.fillStyle = faint;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText('download', contentX + dlWidth + 14, 340);

  // Plan-delivery badge, right-aligned beside the hero number
  if (planDelivery) {
    ctx.font = '800 26px Inter, system-ui, sans-serif';
    const badgeText = planDelivery;
    const padX = 26;
    const badgeW = ctx.measureText(badgeText).width + padX * 2;
    const badgeH = 60;
    const badgeX = contentRight - badgeW;
    const badgeY = 300;
    ctx.fillStyle = '#fff1e8';
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 30);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 79, 22, 0.25)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 30);
    ctx.stroke();
    ctx.fillStyle = orangeDark;
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + padX, badgeY + badgeH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Metric pills, evenly spaced across the panel
  const gap = 24;
  const pillW = (contentRight - contentX - gap * 2) / 3;
  const pillY = 420;
  drawMetric(ctx, contentX, pillY, pillW, 'Upload', `${uploadMbps} Mbps`);
  drawMetric(ctx, contentX + pillW + gap, pillY, pillW, 'Latency', `${latencyMs} ms`);
  drawMetric(ctx, contentX + (pillW + gap) * 2, pillY, pillW, 'Jitter', `${jitterMs} ms`);

  // Footer
  ctx.fillStyle = faint;
  ctx.font = '600 20px Inter, system-ui, sans-serif';
  ctx.fillText('Crowdsourced Kerala internet quality', contentX, 562);
  ctx.textAlign = 'right';
  ctx.fillStyle = orangeDark;
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  ctx.fillText('netundo.in', contentRight, 562);
  ctx.textAlign = 'left';

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      resolve(new File([blob], 'netundo-speed-test.png', { type: 'image/png' }));
    }, 'image/png');
  });
}

function drawMetric(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, value: string) {
  ctx.fillStyle = '#fff7ed';
  roundRect(ctx, x, y, w, 96, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(246, 130, 31, 0.18)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, 96, 22);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText(label.toUpperCase(), x + 24, y + 36);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#171d2b';
  ctx.font = '800 30px Inter, system-ui, sans-serif';
  ctx.fillText(value, x + 24, y + 72);
}

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let trimmed = text;
  while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trim()}...`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

function connectionTypeLabel(type: ConnectionType): string {
  if (type === 'wifi') return 'Wi-Fi';
  if (type === 'mobile') return 'Mobile data';
  return 'Wired';
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
      {title}
      <InfoTooltip text={title} />
    </h3>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-cf-orange shadow-sm [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <span className="text-gray-500">{label}</span>
      <span className="ml-auto max-w-[58%] truncate text-right font-medium text-gray-800">{value}</span>
    </div>
  );
}

function EmptyBox({ label }: { label: string }) {
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        <div className="w-20 h-1.5 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-gray-400 inline">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7v5M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
