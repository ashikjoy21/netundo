'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BandwidthPoint, MeasurementSummary, Scores } from '@cloudflare/speedtest';

export type TestStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

/**
 * Which measurement profile the engine ran. Every connection currently runs the
 * full Cloudflare default profile (100kB → 250MB); the field is kept as
 * provenance so a lighter profile could be reintroduced later without a schema change.
 */
export type MeasurementProfile = 'full' | 'lite';

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
  profile: MeasurementProfile;
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
  profile: 'full',
};

// Total number of measurement steps in the engine's default progressive
// profile (@cloudflare/speedtest 1.10.1). Progress MUST be anchored to the step
// index — not the phase type — because the engine interleaves download and upload
// steps and keeps the heaviest transfers (100MB/250MB download, 50MB upload) for
// last; otherwise the first small upload chunk is mistaken for "deep into the
// test" and the bar races to ~90% while most of the work remains. The engine
// stores its config in a private field, so this count can't be read at runtime;
// if a future version changes the profile the bar is still correct at both ends
// (0 at start, snapped to 1 by onFinish) — only mid-test pacing would drift.
const TOTAL_STEPS = 15;

// If no new measurement sample arrives for this long, the test is stuck (a hung
// request, since the engine's per-request abort is disabled, or a slow-link
// mid-size step grinding). Finalize gracefully with whatever real data exists
// rather than make the user wait. Generous enough that a healthy test of any
// speed — which keeps emitting samples — never trips it.
const STALL_TIMEOUT_MS = 20_000;

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
  // Stall watchdog: finalize gracefully if no new sample arrives for this long.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Promote the engine's current (possibly partial) results to a finished state.
  // Used by the stall watchdog and by the manual "finish now" control, so a slow
  // or stuck test still yields a real reading instead of hanging. Safe to store:
  // the measurement provenance (sample counts, confidence) tags it as lower-sample.
  const finalizeFromCurrent = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    clearWatchdog();
    try { engine.pause(); } catch { /* engine may already be stopped */ }
    const r = engine.results;
    const safe = <T,>(fn: () => T, fallback: T): T => {
      try { return fn(); } catch { return fallback; }
    };
    progressRef.current = 1;
    setState((prev) => {
      if (prev.status === 'done' || prev.status === 'error') return prev;
      return {
        ...prev,
        status: 'done',
        summary: safe(() => r.getSummary(), prev.summary),
        scores: safe(() => r.getScores(), prev.scores),
        downloadPoints: r.getDownloadBandwidthPoints(),
        uploadPoints: r.getUploadBandwidthPoints(),
        unloadedLatencyPoints: r.getUnloadedLatencyPoints(),
        downLoadedLatencyPoints: r.getDownLoadedLatencyPoints(),
        upLoadedLatencyPoints: r.getUpLoadedLatencyPoints(),
        currentPhase: null,
        progress: 1,
        durationMs: safe(() => r.getTotalDurationMs(), prev.durationMs) ?? prev.durationMs,
      };
    });
  }, [clearWatchdog]);

  // Kept in a ref so the engine's long-lived callbacks always call the latest one
  // without forcing createEngine to re-run.
  const finalizeRef = useRef(finalizeFromCurrent);
  finalizeRef.current = finalizeFromCurrent;

  // Re-arm the no-sample stall timer. A healthy test of any speed keeps emitting
  // samples (so this never fires); a single request hung by the engine's disabled
  // per-request abort, or a mid-size step grinding on a slow link, emits none —
  // that's what we catch.
  const armWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => finalizeRef.current(), STALL_TIMEOUT_MS);
  }, []);

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
      armWatchdog(); // advancing a step counts as progress
      setState((prev) => ({ ...prev, currentPhase: type, progress }));
    };

    engine.onResultsChange = ({ type }) => {
      const r = engine.results;
      const progress = recomputeProgress(r);
      armWatchdog(); // a fresh sample arrived — reset the stall timer
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
      clearWatchdog();
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
      // The engine fires onError for non-fatal, per-step failures and then
      // continues to the next step and still finishes. The most common one is
      // the packet-loss test, which runs over WebRTC/TURN and is blocked on many
      // real networks — it's step 6 of 15, mid-test. Treating that as a fatal
      // 'error' status used to drop the UI out of running/done, making the
      // progress bar vanish for the rest of the run (the heavy transfers) while
      // the charts kept filling. Keep the run alive if any bandwidth data has
      // arrived (or we're already done); only surface a hard error when the test
      // produced nothing measurable.
      setState((prev) => {
        const hasData = prev.downloadPoints.length > 0 || prev.uploadPoints.length > 0;
        if (hasData || prev.status === 'done') {
          return { ...prev, error: message };
        }
        clearWatchdog();
        return { ...prev, status: 'error', error: message };
      });
    };

    engineRef.current = engine;
    return engine;
  }, [downloadUrl, uploadUrl, armWatchdog, clearWatchdog]);

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
    armWatchdog(); // start the stall timer once the run is under way
  }, [createEngine, armWatchdog]);

  const pause = useCallback(() => {
    clearWatchdog(); // a paused test shouldn't auto-finalize
    engineRef.current?.pause();
    setState((prev) => ({ ...prev, status: 'paused' }));
  }, [clearWatchdog]);

  const resume = useCallback(() => {
    engineRef.current?.play();
    armWatchdog();
    setState((prev) => ({ ...prev, status: 'running' }));
  }, [armWatchdog]);

  const restart = useCallback(async () => {
    clearWatchdog();
    engineRef.current?.pause();
    engineRef.current = null;
    await start();
  }, [start, clearWatchdog]);

  // Stop the test now and keep whatever has been measured (manual escape hatch
  // for an impatient or very slow connection).
  const finishNow = useCallback(() => {
    finalizeFromCurrent();
  }, [finalizeFromCurrent]);

  useEffect(() => {
    return () => {
      clearWatchdog();
      // No explicit destroy on the engine — just let it GC
    };
  }, [clearWatchdog]);

  return { state, start, pause, resume, restart, finishNow };
}
