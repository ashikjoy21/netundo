'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSpeedTest } from '@/hooks/useSpeedTest';
import { SpeedChart } from './SpeedChart';
import { NetworkQuality } from './NetworkQuality';
import { BoxPlotRow, LatencyBoxPlotRow } from './BoxPlot';
import { DistrictPicker, type ConnectionType, type GeoCoords } from './DistrictPicker';
import {
  formatMbps,
  formatMs,
  formatPct,
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

export function SpeedTest() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [district, setDistrict] = useState('');
  const [connType, setConnType] = useState<ConnectionType>('wifi');
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [resultSubmitted, setResultSubmitted] = useState(false);

  const {
    state: { status, summary, scores, downloadPoints, uploadPoints,
      unloadedLatencyPoints, downLoadedLatencyPoints, upLoadedLatencyPoints,
      currentPhase, edgeColo, edgeCity, asn, ispName, clientIp, error },
    start,
    pause,
    resume,
    restart,
  } = useSpeedTest();

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isDone = status === 'done';

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

  const handleStart = async (d: string, ct: ConnectionType, c: GeoCoords) => {
    setDistrict(d);
    setConnType(ct);
    setCoords(c);
    setAppState('testing');
    setResultSubmitted(false);
    await start();
  };

  // Auto-transition to done
  if (appState === 'testing' && isDone) {
    setAppState('done');
    submitResult();
  }

  async function submitResult() {
    if (resultSubmitted) return;
    setResultSubmitted(true);

    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase || !district || !coords) return;

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
          client: {
            connectionType: connType,
            effectiveType: nav.connection?.effectiveType,
            userAgent: navigator.userAgent,
          },
          location: { district, lat: coords.lat, lng: coords.lng, accuracyM: coords.accuracyM },
          consent: { sharePublicly: true, shareExactLocation: true },
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
      packetLoss: 'Measuring packet loss…',
    };
    return labels[currentPhase] ?? currentPhase;
  }, [currentPhase]);

  // ── Setup screen ──
  if (appState === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Your Internet Speed</h1>
          <p className="text-gray-500 text-sm">Powered by Cloudflare's measurement engine · Kerala Network Quality Map</p>
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

        {/* Phase label */}
        {(isRunning || isPaused) && phaseLabel && (
          <p className="text-xs text-gray-400 mb-2 animate-pulse">{phaseLabel}</p>
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

          {/* Right column: Latency / Jitter / Packet Loss */}
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
            <MetricStat
              label="Packet Loss"
              value={formatPct(summary.packetLoss)}
              unit="%"
              tooltip="Percentage of data packets lost in transit"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {isRunning ? (
            <ActionBtn onClick={pause} icon="⏸" label="Pause" />
          ) : isPaused ? (
            <ActionBtn onClick={resume} icon="▶" label="Resume" />
          ) : null}

          <ActionBtn onClick={handleRetest} icon="↺" label="Retest" />

          {isDone && (
            <ShareButton summary={summary} district={district} />
          )}

          {isDone && (
            <span className="ml-auto text-xs text-gray-400">
              Measured at {new Date().toLocaleTimeString()} · {district} · {connType}
            </span>
          )}
        </div>
      </section>

      {/* ── Network Quality Score ── */}
      <NetworkQuality scores={isDone ? scores : null} />

      {/* ── Two-column detail section ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Server Location */}
        <section className="space-y-3">
          <SectionHeader title="Server Location" />
          <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-2.5">
            <div className="h-56 rounded-lg overflow-hidden mb-3 bg-gray-100">
              <ServerLocationMap
                client={district ? DISTRICT_LATLNG[district] ?? null : null}
                server={edgeColo ? COLO_LATLNG[edgeColo] ?? null : null}
                clientLabel={district ? `You — ${district}` : 'You'}
                serverLabel={edgeCity ? `Cloudflare ${edgeCity}${edgeColo ? ` (${edgeColo})` : ''}` : 'Cloudflare edge'}
              />
            </div>
            <InfoRow icon="🌐" label="Connected via" value="IPv4" />
            <InfoRow
              icon="🖥"
              label="Server location"
              value={edgeCity ? `${edgeCity}${edgeColo ? ` (${edgeColo})` : ''}` : edgeColo ? `Cloudflare ${edgeColo}` : '—'}
            />
            <InfoRow
              icon="📡"
              label="Your network"
              value={ispName ? `${ispName}${asn ? ` (AS${asn})` : ''}` : '—'}
            />
            <InfoRow icon="🔢" label="Your IP address" value={clientIp || '—'} />
            <InfoRow icon="📍" label="Your district" value={district || '—'} />
            <InfoRow icon="📶" label="Connection" value={connType} />
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

      {/* ── Packet Loss ── */}
      <section className="space-y-3">
        <SectionHeader title="Packet Loss Measurements" />
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <details open>
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 select-none list-none">
              <span className="text-sm font-medium text-gray-700">
                Packet Loss Test
              </span>
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4 pt-1">
              {summary.packetLoss != null ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Received</span>
                    <span>{(100 - (summary.packetLoss ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-6 rounded bg-green-100 relative overflow-hidden">
                    <div
                      className="h-full bg-green-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                      style={{ width: `${100 - (summary.packetLoss ?? 0) * 100}%` }}
                    >
                      {(100 - (summary.packetLoss ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 py-2">Couldn't be measured on this network — packet loss uses a UDP connection that some mobile/broadband networks block (Cloudflare's own test shows blank here too).</p>
              )}
            </div>
          </details>
        </div>
      </section>

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

function ActionBtn({ onClick, icon, label }: { onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ShareButton({ summary, district }: { summary: Record<string, unknown>; district: string }) {
  const text = `My internet speed in ${district}: ${formatMbps(summary.download as number)} Mbps ↓ ${formatMbps(summary.upload as number)} Mbps ↑ ${formatMs(summary.latency as number)} ms latency via netundo.in`;

  return (
    <button
      onClick={() => {
        if (navigator.share) {
          navigator.share({ title: 'My Speed Test Result', text }).catch(() => {});
        } else {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all"
    >
      <span>↑</span>
      <span>Share</span>
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
      {title}
      <InfoTooltip text={title} />
    </h3>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-base">{icon}</span>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 ml-auto">{value}</span>
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
