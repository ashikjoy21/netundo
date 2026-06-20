'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BandwidthPoint,
  MeasurementConfig,
  MeasurementSummary,
  Scores,
} from '@cloudflare/speedtest';

export type TestStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

/**
 * Which measurement profile the engine ran. 'full' is Cloudflare's default
 * progressive profile (100kB → 250MB). 'lite' is our trimmed profile for slow /
 * metered links — see pickProfile() below.
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

// ---------------------------------------------------------------------------
// Measurement profiles
// ---------------------------------------------------------------------------

// Lite profile for slow / metered links (mobile data on 2G/3G, Data Saver, or a
// measured downlink under ~2 Mbps). The full default profile escalates to
// 250 MB transfers and — crucially — runs every step's full `count` BEFORE the
// engine decides the link is too slow to continue, so a 1 Mbps user grinds
// through the 1MB and 10MB steps (tens of seconds, tens of MB) before bailing.
//
// Lite caps the payload at 100 KB. On a slow link a 100 KB transfer still lasts
// well over a second — past TCP slow-start — so the bandwidth estimate stays
// sound while total data drops to ~1 MB and total time to well under the default.
// We also drop the WebRTC packet-loss step (TURN is frequently blocked on mobile
// and adds a multi-second stall). Uploads run before any larger work so a
// dead-link abort still leaves a usable up/down/latency reading.
const LITE_MEASUREMENTS: MeasurementConfig[] = [
  { type: 'latency', numPackets: 1 },
  { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: 'latency', numPackets: 8 },
  { type: 'download', bytes: 1e5, count: 6 },
  { type: 'upload', bytes: 1e5, count: 4 },
];

const FULL_TOTAL_STEPS = 15; // @cloudflare/speedtest 1.10.1 default profile

interface NetworkInformationLite {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
}

/**
 * Pick the measurement profile from the Network Information API. Returns the
 * default (full) profile for normal/fast links — leaving `measurements` unset so
 * the engine uses Cloudflare's own profile and results match speed.cloudflare.com.
 * Returns the lite profile (with a dead-link abort ceiling) for slow/metered links.
 */
function pickProfile(): {
  name: MeasurementProfile;
  measurements?: MeasurementConfig[];
  totalSteps: number;
  // Per-request hard ceiling (ms). 0 = disabled (engine default). Only set on
  // lite, where the max payload is small enough that exceeding this means a
  // near-dead link. NOTE: in the engine this aborts the WHOLE test, so it must
  // never be low enough to trip a legitimate transfer.
  abortMs: number;
} {
  const conn = (navigator as Navigator & { connection?: NetworkInformationLite })
    .connection;
  const slow =
    !!conn &&
    (conn.saveData === true ||
      conn.effectiveType === 'slow-2g' ||
      conn.effectiveType === '2g' ||
      conn.effectiveType === '3g' ||
      (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 2));

  if (!slow) return { name: 'full', totalSteps: FULL_TOTAL_STEPS, abortMs: 0 };
  return {
    name: 'lite',
    measurements: LITE_MEASUREMENTS,
    totalSteps: LITE_MEASUREMENTS.length,
    abortMs: 8000,
  };
}

// Progress MUST be anchored to the step index — not to the phase type — because
// the engine interleaves download and upload steps and keeps the heaviest
// transfers for last; otherwise the first small upload chunk is mistaken for
// "deep into the test" and the bar races to ~90% while most of the work remains.
// The total step count depends on the active profile (15 for the full default,
// fewer for lite), so it's tracked per-run in totalStepsRef rather than a const.
// If a future engine version changes the full profile the bar is still correct
// at both ends (0 at start, snapped to 1 by onFinish) — only mid-test pacing drifts.

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
  // Total measurement steps for the active profile (set when the engine is built).
  const totalStepsRef = useRef(FULL_TOTAL_STEPS);

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

    // Slow / metered links get the trimmed lite profile so the test stays short
    // and light instead of grinding through the full profile's MB-scale steps.
    // Normal links keep `measurements` UNSET so the engine runs Cloudflare's own
    // profile (results match speed.cloudflare.com by construction).
    const profile = pickProfile();
    if (profile.measurements) {
      config.measurements = profile.measurements;
      // Dead-link ceiling: aborts the run if a single small request hangs past
      // this. Engine default is 0 (off); only enabled on lite, where the small
      // payload makes a long request a sign of a near-dead connection.
      if (profile.abortMs > 0) config.bandwidthAbortRequestDuration = profile.abortMs;
    }
    totalStepsRef.current = profile.totalSteps;
    setState((prev) => ({ ...prev, profile: profile.name }));

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
      const raw = (s.id + frac) / totalStepsRef.current;
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
        return { ...prev, status: 'error', error: message };
      });
    };

    engineRef.current = engine;
    return engine;
  }, [downloadUrl, uploadUrl]);

  const start = useCallback(async () => {
    progressRef.current = 0;
    stepRef.current = { id: 0, type: null, expected: 0, base: 0 };
    totalStepsRef.current = FULL_TOTAL_STEPS; // re-derived in createEngine()
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
