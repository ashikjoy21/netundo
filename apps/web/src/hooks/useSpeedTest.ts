'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BandwidthPoint, MeasurementSummary, Scores } from '@cloudflare/speedtest';

export type TestStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

export interface SpeedTestState {
  status: TestStatus;
  error: string | null;
  summary: MeasurementSummary;
  scores: Scores | null;
  downloadPoints: BandwidthPoint[];
  uploadPoints: BandwidthPoint[];
  unloadedLatencyPoints: number[];
  downLoadedLatencyPoints: number[];
  upLoadedLatencyPoints: number[];
  currentPhase: string | null;
  progress: number;
  durationMs: number | null;
  ispName: string | null;
  edgeColo: string | null;
  edgeCity: string | null;
  asn: number | null;
  clientIp: string | null;
}

const initialState: SpeedTestState = {
  status: 'idle',
  error: null,
  summary: {},
  scores: null,
  downloadPoints: [],
  uploadPoints: [],
  unloadedLatencyPoints: [],
  downLoadedLatencyPoints: [],
  upLoadedLatencyPoints: [],
  currentPhase: null,
  progress: 0,
  durationMs: null,
  ispName: null,
  edgeColo: null,
  edgeCity: null,
  asn: null,
  clientIp: null,
};

// Saturating 0→1 curve: rises fast then eases toward 1 as `n` grows, never
// reaching it. `halfLife` is the count at which it hits 0.5.
function saturate(n: number, halfLife: number): number {
  if (n <= 0) return 0;
  return 1 - Math.pow(2, -n / halfLife);
}

// Phase-anchored progress estimate (0–1). Keyed on the measurement *phase* and
// the number of data points received so far, NOT on a timer — so the bar moves
// forward monotonically and never runs ahead of the real measurement. The true
// "done" (1.0) is set separately from the engine's onFinish, independent of
// this estimate. Bands: latency 0–15%, download 15–60%, upload 60–95%,
// finalizing 95–99%.
function estimateProgress(
  phase: string | null,
  downloadCount: number,
  uploadCount: number,
  latencyCount: number,
): number {
  // Upload is the last long phase — once it has points, we're in 60–95%.
  if (uploadCount > 0 || phase === 'upload') {
    return 0.6 + 0.35 * saturate(uploadCount, 10);
  }
  // Download phase: 15–60%.
  if (downloadCount > 0 || phase === 'download') {
    return 0.15 + 0.45 * saturate(downloadCount, 14);
  }
  // Latency / startup: 2–15%.
  if (latencyCount > 0 || phase === 'latency' || phase === 'latencyUnderLoad') {
    return 0.02 + 0.13 * saturate(latencyCount, 4);
  }
  return 0.02;
}

export function useSpeedTest(downloadUrl?: string, uploadUrl?: string) {
  const [state, setState] = useState<SpeedTestState>(initialState);
  const engineRef = useRef<import('@cloudflare/speedtest').default | null>(null);
  // Progress only ever moves forward within a run; reset on start/restart.
  const progressRef = useRef(0);

  // Lazily create engine (browser-only)
  const createEngine = useCallback(async () => {
    const { default: SpeedTest } = await import('@cloudflare/speedtest');

    // Accuracy note: leaving downloadApiUrl/uploadApiUrl UNSET makes the engine
    // use Cloudflare's own global measurement endpoints (speed.cloudflare.com),
    // which is the most accurate option — results match speed.cloudflare.com by
    // construction (same edge, same default measurement profile). Self-hosting is
    // an opt-in via NEXT_PUBLIC_SPEEDTEST_WORKER_URL; the worker must expose the
    // engine's /__down and /__up paths (see workers/speedtest).
    //
    // We do NOT override `measurements` — the engine's default progressive profile
    // (100kB → 250MB download, 100kB → 50MB upload) is exactly what powers
    // speed.cloudflare.com. Percentiles below also mirror Cloudflare's defaults.
    const config: import('@cloudflare/speedtest').ConfigOptions = {
      autoStart: false,
      measureDownloadLoadedLatency: true,
      measureUploadLoadedLatency: true,
      bandwidthPercentile: 0.9, // download/upload reported at p90 (Cloudflare default)
      latencyPercentile: 0.5, // latency reported at p50/median (Cloudflare default)
    };

    // Prefer explicit args, then env-configured self-hosted worker, else CF defaults.
    const workerBase = (downloadUrl || uploadUrl)
      ? null
      : process.env.NEXT_PUBLIC_SPEEDTEST_WORKER_URL?.replace(/\/$/, '');

    const dl = downloadUrl ?? (workerBase ? `${workerBase}/__down` : undefined);
    const ul = uploadUrl ?? (workerBase ? `${workerBase}/__up` : undefined);

    if (dl) config.downloadApiUrl = dl;
    if (ul) config.uploadApiUrl = ul;

    const engine = new SpeedTest(config);

    engine.onRunningChange = (running) => {
      setState((prev) => ({
        ...prev,
        status: running ? 'running' : prev.status === 'running' ? 'paused' : prev.status,
      }));
    };

    // Fired when the engine advances to a new measurement step. We rely on the
    // phase `type` (from onResultsChange) for banding, but reading the phase
    // here too keeps the bar moving even before a phase has produced points.
    engine.onPhaseChange = ({ measurement }) => {
      const phase = measurement?.type ?? null;
      setState((prev) => {
        const next = estimateProgress(
          phase,
          prev.downloadPoints.length,
          prev.uploadPoints.length,
          prev.unloadedLatencyPoints.length,
        );
        progressRef.current = Math.max(progressRef.current, next);
        return { ...prev, currentPhase: phase, progress: progressRef.current };
      });
    };

    engine.onResultsChange = ({ type }) => {
      const r = engine.results;
      const downloadPoints = r.getDownloadBandwidthPoints();
      const uploadPoints = r.getUploadBandwidthPoints();
      const unloadedLatencyPoints = r.getUnloadedLatencyPoints();
      const next = estimateProgress(
        type,
        downloadPoints.length,
        uploadPoints.length,
        unloadedLatencyPoints.length,
      );
      progressRef.current = Math.min(0.99, Math.max(progressRef.current, next));
      setState((prev) => ({
        ...prev,
        summary: r.getSummary(),
        downloadPoints,
        uploadPoints,
        unloadedLatencyPoints,
        downLoadedLatencyPoints: r.getDownLoadedLatencyPoints(),
        upLoadedLatencyPoints: r.getUpLoadedLatencyPoints(),
        currentPhase: type,
        progress: progressRef.current,
      }));
    };

    engine.onFinish = (results) => {
      progressRef.current = 1;
      setState((prev) => ({
        ...prev,
        status: 'done',
        summary: results.getSummary(),
        scores: results.getScores(),
        downloadPoints: results.getDownloadBandwidthPoints(),
        uploadPoints: results.getUploadBandwidthPoints(),
        unloadedLatencyPoints: results.getUnloadedLatencyPoints(),
        downLoadedLatencyPoints: results.getDownLoadedLatencyPoints(),
        upLoadedLatencyPoints: results.getUpLoadedLatencyPoints(),
        currentPhase: null,
        progress: 1,
        durationMs: results.getTotalDurationMs() ?? null,
      }));
    };

    engine.onError = (message) => {
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    };

    engineRef.current = engine;
    return engine;
  }, [downloadUrl, uploadUrl]);

  const start = useCallback(async () => {
    progressRef.current = 0;
    setState({ ...initialState, status: 'running' });

    // ISP / ASN / client IP come from our api worker (accurate regardless of which
    // colo it happens to route to).
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (apiBase) {
      fetch(`${apiBase}/v1/health`)
        .then((r) => r.json())
        .then((data: {
          asn?: number | null;
          asOrganization?: string | null;
          organization?: string | null;
          clientIp?: string | null;
        }) => {
          setState((prev) => ({
            ...prev,
            asn: data.asn ?? null,
            ispName: data.asOrganization ?? data.organization ?? null,
            clientIp: prev.clientIp ?? data.clientIp ?? null,
          }));
        })
        .catch(() => {});
    }

    // The *server location* must reflect the colo that actually served the
    // measurement (speed.cloudflare.com or the self-hosted worker), not our api
    // worker — those can differ. `/cdn-cgi/trace` reports the real edge colo.
    const { coloCity } = await import('@/lib/utils');
    const measurementBase =
      process.env.NEXT_PUBLIC_SPEEDTEST_WORKER_URL?.replace(/\/$/, '') ||
      'https://speed.cloudflare.com';
    fetch(`${measurementBase}/cdn-cgi/trace`)
      .then((r) => r.text())
      .then((text) => {
        const trace = Object.fromEntries(
          text.trim().split('\n').map((line) => {
            const i = line.indexOf('=');
            return [line.slice(0, i), line.slice(i + 1)];
          }),
        );
        const colo = trace.colo || null;
        setState((prev) => ({
          ...prev,
          edgeColo: colo,
          edgeCity: coloCity(colo),
          clientIp: trace.ip || prev.clientIp,
        }));
      })
      .catch(() => {});

    const engine = await createEngine();
    engine.play();
  }, [createEngine]);

  const pause = useCallback(() => {
    engineRef.current?.pause();
    setState((prev) => ({ ...prev, status: 'paused' }));
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.play();
    setState((prev) => ({ ...prev, status: 'running' }));
  }, []);

  const restart = useCallback(async () => {
    engineRef.current?.pause();
    engineRef.current = null;
    await start();
  }, [start]);

  useEffect(() => {
    return () => {
      // No explicit destroy on the engine — just let it GC
    };
  }, []);

  return { state, start, pause, resume, restart };
}
