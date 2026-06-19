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
  ispName: null,
  edgeColo: null,
  edgeCity: null,
  asn: null,
  clientIp: null,
};

export function useSpeedTest(downloadUrl?: string, uploadUrl?: string) {
  const [state, setState] = useState<SpeedTestState>(initialState);
  const engineRef = useRef<import('@cloudflare/speedtest').default | null>(null);

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

    engine.onResultsChange = ({ type }) => {
      const r = engine.results;
      setState((prev) => ({
        ...prev,
        summary: r.getSummary(),
        downloadPoints: r.getDownloadBandwidthPoints(),
        uploadPoints: r.getUploadBandwidthPoints(),
        unloadedLatencyPoints: r.getUnloadedLatencyPoints(),
        downLoadedLatencyPoints: r.getDownLoadedLatencyPoints(),
        upLoadedLatencyPoints: r.getUpLoadedLatencyPoints(),
        currentPhase: type,
      }));
    };

    engine.onFinish = (results) => {
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
      }));
    };

    engine.onError = (message) => {
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    };

    engineRef.current = engine;
    return engine;
  }, [downloadUrl, uploadUrl]);

  const start = useCallback(async () => {
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
