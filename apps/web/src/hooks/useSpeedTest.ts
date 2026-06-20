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

// Total number of measurement steps in the engine's default progressive
// profile (@cloudflare/speedtest 1.10.1). The engine interleaves download and
// upload steps and keeps the heaviest transfers (100MB/250MB download, 50MB
// upload) for last, so progress MUST be anchored to the step index — not to the
// phase type — otherwise the first small upload chunk (step 5 of 15) is mistaken
// for "deep into the test" and the bar races to ~90% while most of the work
// remains. The engine stores its config in a private field, so this count can't
// be read at runtime; if a future version changes the profile the bar is still
// correct at both ends (0 at start, snapped to 1 by onFinish) — only the
// mid-test pacing would drift.
const TOTAL_STEPS = 15;

// Tracks the current measurement step so progress can be interpolated within it.
interface StepState {
  id: number; // measurementId: index into the engine's measurements array
  type: string | null; // 'latency' | 'download' | 'upload' | 'packetLoss' | …
  expected: number; // number of samples this step will collect (0 if unknown)
  base: number; // cumulative sample count of this type when the step started
}

export function useSpeedTest(downloadUrl?: string, uploadUrl?: string) {
  const [state, setState] = useState<SpeedTestState>(initialState);
  const engineRef = useRef<import('@cloudflare/speedtest').default | null>(null);
  // Progress only ever moves forward within a run; reset on start/restart.
  const progressRef = useRef(0);
  const stepRef = useRef<StepState>({ id: 0, type: null, expected: 0, base: 0 });

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

    // Number of samples of a given measurement type collected so far. Used to
    // interpolate progress within the current step.
    const sampleCount = (
      r: import('@cloudflare/speedtest').Results,
      type: string | null,
    ): number => {
      if (type === 'download') return r.getDownloadBandwidthPoints().length;
      if (type === 'upload') return r.getUploadBandwidthPoints().length;
      if (type === 'latency') return r.getUnloadedLatencyPoints().length;
      return 0;
    };

    // Step-anchored progress (0–1), monotonic, capped below 1 so only onFinish
    // can reach 100%. Base = step index / total steps; within a step we add the
    // fraction of its expected samples already collected, so the bar advances
    // smoothly through each step instead of jumping.
    const recomputeProgress = (r: import('@cloudflare/speedtest').Results) => {
      const s = stepRef.current;
      let frac = 0;
      if (s.expected > 0) {
        const got = sampleCount(r, s.type) - s.base;
        frac = Math.min(1, Math.max(0, got / s.expected));
      }
      const raw = (s.id + frac) / TOTAL_STEPS;
      progressRef.current = Math.min(0.98, Math.max(progressRef.current, raw));
      return progressRef.current;
    };

    // Fired when the engine advances to a new measurement step. measurementId is
    // the step's index in the engine's measurements array — the ground truth for
    // how far through the test we are.
    engine.onPhaseChange = ({ measurementId, measurement }) => {
      const type = measurement?.type ?? null;
      const r = engine.results;
      const expected =
        'count' in measurement && typeof measurement.count === 'number' ? measurement.count : 0;
      stepRef.current = { id: measurementId, type, expected, base: sampleCount(r, type) };
      const progress = recomputeProgress(r);
      setState((prev) => ({ ...prev, currentPhase: type, progress }));
    };

    engine.onResultsChange = ({ type }) => {
      const r = engine.results;
      const progress = recomputeProgress(r);
      setState((prev) => ({
        ...prev,
        summary: r.getSummary(),
        downloadPoints: r.getDownloadBandwidthPoints(),
        uploadPoints: r.getUploadBandwidthPoints(),
        unloadedLatencyPoints: r.getUnloadedLatencyPoints(),
        downLoadedLatencyPoints: r.getDownLoadedLatencyPoints(),
        upLoadedLatencyPoints: r.getUpLoadedLatencyPoints(),
        currentPhase: type,
        progress,
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
    stepRef.current = { id: 0, type: null, expected: 0, base: 0 };
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
