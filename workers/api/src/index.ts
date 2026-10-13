/**
 * netundo-api — Cloudflare Worker
 *
 * Results ingestion and aggregation API.
 * Routes:
 *   POST /v1/results
 *   GET  /v1/results/:id
 *   PATCH /v1/results/:id/provider
 *   GET  /v1/aggregate
 *   GET  /v1/locate
 *   POST /v1/reports
 *   GET  /v1/status
 *   GET  /v1/outages/active
 *   POST  /v1/operator/updates        (Bearer operator token)
 *   PATCH /v1/operator/updates/:id    (Bearer operator token)
 *   GET   /v1/operator/updates        (Bearer operator token)
 *
 * Cron (every 5 min): closes outage events that have stopped getting reports.
 *   POST /v1/feedback
 *   GET  /v1/health
 */

import { displayNameForKey, isKnownProviderSlug } from '@netundo/types';
import { aggregateByBrand, percentile, type BrandTestRow, type PlaceGrouping } from './aggregate';
import { locateTaluk } from './locate';
import { buildStatus, isKnownDistrict, isKnownTaluk, validateReport, type EventRow, type ReportPayload, type ReportRow } from './outages';
import { dailyIpHash, tokenHash } from './privacy';
import {
  isVisibleUpdate,
  parseBearer,
  publicUpdate,
  validateCreate,
  validatePatch,
  type AreaInput,
  type OperatorRow,
  type UpdateFields,
  type UpdateRow,
} from './operator';

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  /** Secret key for IP / client-token HMACs (wrangler secret put IP_HASH_SALT). */
  IP_HASH_SALT?: string;
  OUTAGE_MIN_REPORTS?: string;
  OUTAGE_WINDOW_MIN?: string;
  RIGHT_NOW_WINDOW_MIN?: string;
}

/** Numeric [vars] with defaults, so a missing var never breaks a route. */
function outageConfig(env: Env) {
  const int = (v: string | undefined, fallback: number, min = 1) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  return {
    minReports: int(env.OUTAGE_MIN_REPORTS, 3),
    windowMin: int(env.OUTAGE_WINDOW_MIN, 30),
    rightNowMin: int(env.RIGHT_NOW_WINDOW_MIN, 60),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Typed as Set<string> so we can use .has() with untrusted string input
const KERALA_DISTRICTS: Set<string> = new Set([
  'Thiruvananthapuram',
  'Kollam',
  'Pathanamthitta',
  'Alappuzha',
  'Kottayam',
  'Idukki',
  'Ernakulam',
  'Thrissur',
  'Palakkad',
  'Malappuram',
  'Kozhikode',
  'Wayanad',
  'Kannur',
  'Kasaragod',
]);

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultPayload {
  summary: {
    download?: number;
    upload?: number;
    latency?: number;
    jitter?: number;
    downLoadedLatency?: number;
    upLoadedLatency?: number;
    packetLoss?: number;
  };
  scores?: Record<string, { points: number; classificationName: string }>;
  client: {
    connectionType: 'mobile' | 'wifi' | 'wired';
    effectiveType?: string;
    userAgent: string;
  };
  location: {
    district: string;
    taluk?: string;
    village?: string;
    lat?: number;
    lng?: number;
    accuracyM?: number;
  };
  plan?: {
    advertisedMbps?: number;
  };
  /** Random per-browser token; lets this browser attach its provider answer later. */
  clientToken?: string;
  provider?: ProviderAnswer;
  consent: {
    sharePublicly: boolean;
    shareExactLocation: boolean;
  };
}

interface ProviderAnswer {
  /** Brand slug from providers.ts, or 'lco' / 'other'. */
  reported?: string;
  /** Free-text name for 'lco' / 'other'. */
  name?: string;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (resets per worker isolate restart)
// ---------------------------------------------------------------------------

// Map<ipHash, { count: number; windowStart: number }>
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;

async function isRateLimited(ipHash: string): Promise<boolean> {
  const now = Date.now();
  const entry = rateLimitStore.get(ipHash);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ipHash, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Headers {
  return new Headers(CORS_HEADERS);
}

function jsonResponse(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = corsHeaders();
  headers.set('Content-Type', 'application/json');
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, v as string);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** SHA-256 of a string, returned as hex. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 of IP + salt, returned as hex string */
async function hashIp(ip: string, salt = 'netundo-v1'): Promise<string> {
  return sha256Hex(ip + salt);
}

/** Client tokens are random strings the browser generates once and keeps in
 *  localStorage. We only ever store their hash. */
function validClientToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

/** Trimmed, length-capped free text, or null. */
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Validate a "Who's your provider?" answer into DB columns, or an error. */
function providerColumns(
  answer: ProviderAnswer | undefined,
): { provider_reported: string; provider_reported_name: string | null } | { error: string } | null {
  if (!answer || answer.reported == null) return null;
  const reported = typeof answer.reported === 'string' ? answer.reported.trim().toLowerCase() : '';
  if (!isKnownProviderSlug(reported)) return { error: 'provider.reported is not a known provider' };
  const name = shortText(answer.name, 60);
  if ((reported === 'lco' || reported === 'other') && !name) {
    return { error: 'provider.name is required for a local cable operator or other provider' };
  }
  return {
    provider_reported: reported,
    provider_reported_name: reported === 'lco' || reported === 'other' ? name : null,
  };
}

/** Generate a v4 UUID using the Web Crypto API */
function uuidv4(): string {
  return crypto.randomUUID();
}

/** Supabase REST client — uses fetch directly, no SDK */
function makeSupabase(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return null;
  }

  return async function supabase(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** OPTIONS — CORS pre-flight */
function handleOptions(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** GET /v1/health
 *
 * Returns edge + client network metadata derived from Cloudflare's request
 * properties, mirroring what speed.cloudflare.com shows in its "Server Location"
 * panel (ISP/ASN, client IP, edge colo + city). Read from `request.cf`, which is
 * populated for requests that hit a Worker on the Cloudflare edge.
 */
function handleHealth(request: Request): Response {
  const cf = request.cf as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown) => (typeof v === 'number' ? v : null);

  return jsonResponse({
    status: 'ok',
    colo: str(cf?.colo),
    city: str(cf?.city),
    country: str(cf?.country),
    asn: num(cf?.asn),
    asOrganization: str(cf?.asOrganization) ?? str(cf?.organization),
    clientIp: request.headers.get('CF-Connecting-IP'),
  });
}

/** POST /v1/results */
async function handlePostResult(
  request: Request,
  env: Env,
): Promise<Response> {
  // --- Parse body ---
  let payload: ResultPayload;
  try {
    payload = (await request.json()) as ResultPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // --- Validate required fields ---
  if (!payload?.location?.district) {
    return jsonResponse({ error: 'location.district is required' }, 422);
  }
  if (!KERALA_DISTRICTS.has(payload.location.district)) {
    return jsonResponse(
      { error: `district must be one of the 14 Kerala districts` },
      422,
    );
  }
  if (!['mobile', 'wifi', 'wired'].includes(payload?.client?.connectionType)) {
    return jsonResponse(
      { error: 'client.connectionType must be mobile, wifi, or wired' },
      422,
    );
  }
  if (
    typeof payload?.consent?.sharePublicly !== 'boolean' ||
    typeof payload?.consent?.shareExactLocation !== 'boolean'
  ) {
    return jsonResponse(
      { error: 'consent.sharePublicly and consent.shareExactLocation are required booleans' },
      422,
    );
  }

  // --- Rate limiting ---
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(ip);
  if (await isRateLimited(ipHash)) {
    return jsonResponse(
      { error: 'Rate limit exceeded: max 10 tests per hour' },
      429,
    );
  }

  // --- Server-side enrichment from Cloudflare metadata ---
  // Trustworthy ISP detection: read from request.cf at the edge (the client can't
  // spoof it). The correct field is `asOrganization` (e.g. "Peak Air Pvt Ltd");
  // `organization` is not a populated cf field, so it was always null before.
  const cf = request.cf as Record<string, unknown> | undefined;
  const asn = typeof cf?.asn === 'number' ? cf.asn : null;
  const ispOrg =
    (typeof cf?.asOrganization === 'string' && cf.asOrganization) ||
    (typeof cf?.organization === 'string' && cf.organization) ||
    null;
  const colo = typeof cf?.colo === 'string' ? cf.colo : null;

  // --- Build DB row ---
  const id = uuidv4();
  const { summary, scores, client, location, plan, consent } = payload;

  const provider = providerColumns(payload.provider);
  if (provider && 'error' in provider) {
    return jsonResponse({ error: provider.error }, 422);
  }
  const village = shortText(location.village, 80);
  const clientTokenHash = validClientToken(payload.clientToken)
    ? await sha256Hex(payload.clientToken)
    : null;

  const planMbps =
    typeof plan?.advertisedMbps === 'number' &&
    plan.advertisedMbps > 0 &&
    plan.advertisedMbps <= 10000
      ? plan.advertisedMbps
      : null;

  // Convert bps -> Mbps; keep null when absent
  const bpsToMbps = (v?: number) =>
    typeof v === 'number' ? v / 1_000_000 : null;

  const row = {
    id,
    download_mbps: bpsToMbps(summary?.download),
    upload_mbps: bpsToMbps(summary?.upload),
    latency_ms: summary?.latency ?? null,
    jitter_ms: summary?.jitter ?? null,
    loaded_latency_down_ms: summary?.downLoadedLatency ?? null,
    loaded_latency_up_ms: summary?.upLoadedLatency ?? null,
    // packetLoss from engine is 0-1 fraction; store as percentage
    packet_loss_pct:
      typeof summary?.packetLoss === 'number'
        ? summary.packetLoss * 100
        : null,

    // AIM quality scores
    aim_streaming: scores?.['streaming']?.classificationName ?? null,
    aim_gaming: scores?.['gaming']?.classificationName ?? null,
    aim_rt_comms: scores?.['rtc']?.classificationName ?? null,

    // Connection context
    connection_type: client.connectionType,
    effective_type: client.effectiveType ?? null,
    user_agent: client.userAgent,

    // Network / ISP
    isp_name: ispOrg,
    isp_org: ispOrg,
    asn,

    // Advertised plan speed (user-reported). Only included when present so that
    // inserts keep working even before the plan_mbps migration is applied.
    ...(planMbps != null ? { plan_mbps: planMbps } : {}),

    // Kerala location
    district: location.district,
    taluk: location.taluk ?? null,
    // New columns (migration 011) are only sent when set, so inserts keep
    // working if the worker is deployed before the migration is applied.
    ...(village ? { village } : {}),
    ...(provider ? provider : {}),
    ...(clientTokenHash ? { client_token_hash: clientTokenHash } : {}),
    // Exact location only stored on explicit consent, rounded to ~110 m for privacy.
    ...(() => {
      const shareExact =
        consent.shareExactLocation &&
        typeof location.lat === 'number' &&
        typeof location.lng === 'number';
      const round3 = (v: number) => Math.round(v * 1000) / 1000;
      return shareExact
        ? {
            lat: round3(location.lat as number),
            lng: round3(location.lng as number),
            location: `POINT(${round3(location.lng as number)} ${round3(location.lat as number)})`,
          }
        : { lat: null, lng: null, location: null };
    })(),
    location_accuracy_m: location.accuracyM ?? null,

    // Edge server
    edge_colo: colo,

    // Privacy
    ip_hash: ipHash,
    consent_public: consent.sharePublicly,
    consent_exact_location: consent.shareExactLocation,

    is_outlier: false,
  };

  // --- Persist to Supabase ---
  const supabase = makeSupabase(env);
  if (!supabase) {
    // Development fallback — no credentials configured
    return jsonResponse(
      { error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.' },
      503,
    );
  }

  const insertRes = await supabase('test_results', {
    method: 'POST',
    body: JSON.stringify(row),
    headers: {
      // Return the inserted row so we can confirm the id
      Prefer: 'return=minimal',
    },
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error('Supabase insert error', insertRes.status, errText);
    return jsonResponse({ error: 'Failed to store result' }, 502);
  }

  return jsonResponse({ id, success: true }, 201);
}

/** GET /v1/results/:id */
async function handleGetResult(id: string, env: Env): Promise<Response> {
  if (!id || id.length < 10) {
    return jsonResponse({ error: 'Invalid result ID' }, 400);
  }

  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse(
      { error: 'Supabase not configured' },
      503,
    );
  }

  // Only return rows where consent_public = true (RLS also enforces this,
  // but we add the filter to be explicit and avoid 403 surprises)
  const params = new URLSearchParams({
    id: `eq.${id}`,
    consent_public: 'eq.true',
    is_outlier: 'eq.false',
    select: '*',
    limit: '1',
  });

  const res = await supabase(`test_results?${params}`);

  if (!res.ok) {
    console.error('Supabase fetch error', res.status);
    return jsonResponse({ error: 'Failed to fetch result' }, 502);
  }

  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: 'Result not found or not public' }, 404);
  }

  return jsonResponse(rows[0]);
}

/** PATCH /v1/results/:id/provider — attach the "Who's your provider?" answer
 *  after the test. Only the browser that ran the test (same client token) can do
 *  this, and only for 2 hours. */
async function handlePatchProvider(id: string, request: Request, env: Env): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonResponse({ error: 'Invalid result ID' }, 400);
  }
  let body: { clientToken?: unknown; provider?: ProviderAnswer };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!validClientToken(body.clientToken)) {
    return jsonResponse({ error: 'clientToken is required' }, 422);
  }
  const provider = providerColumns(body.provider);
  if (!provider) return jsonResponse({ error: 'provider.reported is required' }, 422);
  if ('error' in provider) return jsonResponse({ error: provider.error }, 422);

  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse({ error: 'Supabase not configured' }, 503);

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    id: `eq.${id}`,
    client_token_hash: `eq.${await sha256Hex(body.clientToken)}`,
    created_at: `gte.${cutoff}`,
    select: 'id',
  });
  const res = await supabase(`test_results?${params}`, {
    method: 'PATCH',
    body: JSON.stringify(provider),
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) {
    console.error('Supabase provider patch error', res.status, await res.text());
    return jsonResponse({ error: 'Failed to save provider' }, 502);
  }
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: 'Result not found, not yours, or too old to edit' }, 404);
  }
  return jsonResponse({ success: true });
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

interface TestResultRow {
  district: string;
  taluk: string | null;
  isp_name: string | null;
  asn: number | null;
  connection_type: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  latency_ms: number | null;
  jitter_ms: number | null;
  created_at: string;
}

interface TraiRow {
  period: string;
  operator: string;
  technology: string;
  direction: string;
  avg_mbps: number;
  sample_count: number | null;
  source: string;
}

/** Most frequently occurring non-null isp_name in a bucket (mode), for display. */
function representativeIspName(rows: TestResultRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.isp_name) counts.set(r.isp_name, (counts.get(r.isp_name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

interface AggregateOutRow {
  district: string;
  taluk?: string | null;
  asn: number | null;
  isp_name: string | null;
  connection_type: string;
  sample_count: number;
  p50_download_mbps: number | null;
  p90_download_mbps: number | null;
  avg_download_mbps: number | null;
  p50_upload_mbps: number | null;
  p90_upload_mbps: number | null;
  p50_latency_ms: number | null;
  avg_latency_ms: number | null;
  p50_jitter_ms: number | null;
}

/** Aggregate raw test_results in the worker (materialized view may be stale).
 *
 * When `byTaluk` is true, results are also bucketed by `taluk` and each output
 * row carries a `taluk` field. Rows with a null taluk are grouped under the
 * empty bucket and surface as `taluk: null` so callers can still use them as
 * district-level context. */
function aggregateTestResults(
  rows: TestResultRow[],
  byTaluk = false,
): AggregateOutRow[] {
  const groups = new Map<string, TestResultRow[]>();

  for (const row of rows) {
    // Group by ASN (the stable network identifier), not the display name which
    // can drift over time. Add taluk to the key when requested.
    const talukPart = byTaluk ? `|${row.taluk ?? ''}` : '';
    const key = `${row.district}${talukPart}|${row.asn ?? ''}|${row.connection_type}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()].map(([, bucket]) => {
    const nums = (field: keyof TestResultRow) =>
      bucket
        .map((r) => r[field])
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b);

    const first = bucket[0];
    return {
      district: first.district,
      ...(byTaluk ? { taluk: first.taluk ?? null } : {}),
      asn: first.asn,
      isp_name: representativeIspName(bucket),
      connection_type: first.connection_type,
      sample_count: bucket.length,
      p50_download_mbps: percentile(nums('download_mbps'), 0.5),
      p90_download_mbps: percentile(nums('download_mbps'), 0.9),
      avg_download_mbps: mean(nums('download_mbps')),
      p50_upload_mbps: percentile(nums('upload_mbps'), 0.5),
      p90_upload_mbps: percentile(nums('upload_mbps'), 0.9),
      p50_latency_ms: percentile(nums('latency_ms'), 0.5),
      avg_latency_ms: mean(nums('latency_ms')),
      p50_jitter_ms: percentile(nums('jitter_ms'), 0.5),
    };
  });
}

const PERIOD_DAYS: Record<string, number | null> = {
  weekly: 7,
  monthly: 28,
  quarter: 90,
  all: null,
};

/** GET /v1/aggregate?by=brand — rankings grouped by provider brand and
 *  connection kind (broadband | mobile) instead of raw ASN.
 *
 *  Params: group=district|taluk|village (default district), period=weekly|
 *  monthly|quarter|all (default monthly; taluk/village grouping defaults to all),
 *  district, taluk, kind=broadband|mobile, brand=<brand key>. */
async function handleBrandAggregate(url: URL, env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse({ error: 'Supabase not configured' }, 503);

  const groupParam = url.searchParams.get('group');
  const grouping: PlaceGrouping =
    groupParam === 'taluk' || groupParam === 'village' ? groupParam : 'district';
  const period = url.searchParams.get('period') ?? (grouping === 'district' ? 'monthly' : 'all');
  if (!(period in PERIOD_DAYS)) {
    return jsonResponse({ error: 'period must be weekly, monthly, quarter or all' }, 422);
  }
  const kind = url.searchParams.get('kind');
  if (kind && kind !== 'broadband' && kind !== 'mobile') {
    return jsonResponse({ error: 'kind must be broadband or mobile' }, 422);
  }

  const baseColumns =
    'district,taluk,isp_name,asn,connection_type,download_mbps,upload_mbps,latency_ms,jitter_ms,created_at';
  const params = new URLSearchParams({
    select: `${baseColumns},village,provider_reported,provider_reported_name`,
    is_outlier: 'eq.false',
    source: 'eq.netundo',
    order: 'created_at.desc',
    limit: period === 'weekly' || period === 'monthly' ? '5000' : '50000',
  });
  const days = PERIOD_DAYS[period];
  if (days != null) {
    params.set('created_at', `gte.${new Date(Date.now() - days * 86_400_000).toISOString()}`);
  }
  const district = url.searchParams.get('district');
  const taluk = url.searchParams.get('taluk');
  if (district) params.set('district', `eq.${district}`);
  if (taluk) params.set('taluk', `eq.${taluk}`);

  let res = await supabase(`test_results?${params}`);
  if (res.status === 400) {
    // Migration 011 not applied yet: fall back to the columns that exist.
    params.set('select', baseColumns);
    res = await supabase(`test_results?${params}`);
  }
  if (!res.ok) {
    console.error('Supabase brand aggregate error', res.status);
    return jsonResponse({ error: 'Failed to fetch aggregates' }, 502);
  }
  const rows = (await res.json()) as BrandTestRow[];
  if (!Array.isArray(rows)) return jsonResponse({ error: 'Invalid aggregate response' }, 502);

  return jsonResponse(
    aggregateByBrand(rows, grouping, { brand: url.searchParams.get('brand'), kind }),
    200,
    { 'Cache-Control': 'public, max-age=120' },
  );
}

/** GET /v1/aggregate */
async function handleAggregate(url: URL, env: Env): Promise<Response> {
  if (url.searchParams.get('by') === 'brand') return handleBrandAggregate(url, env);

  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse(
      { error: 'Supabase not configured' },
      503,
    );
  }

  const district = url.searchParams.get('district');
  const taluk = url.searchParams.get('taluk');
  const isp = url.searchParams.get('isp');
  const asn = url.searchParams.get('asn');
  const connectionType = url.searchParams.get('connection_type');
  const period = url.searchParams.get('period'); // 'weekly' | 'monthly'
  // group=taluk powers the statically-generated locality pages: it buckets by
  // taluk and uses an all-time window with a higher row cap so a single build
  // request can snapshot the whole state.
  const byTaluk = url.searchParams.get('group') === 'taluk';

  const params = new URLSearchParams({
    select: byTaluk
      ? 'district,taluk,isp_name,asn,connection_type,download_mbps,upload_mbps,latency_ms,jitter_ms,created_at'
      : 'district,isp_name,asn,connection_type,download_mbps,upload_mbps,latency_ms,jitter_ms,created_at',
    is_outlier: 'eq.false',
    // Real aggregates use netundo-measured tests only; third-party tests
    // (source='mlab') are excluded so they never skew our methodology.
    source: 'eq.netundo',
    order: 'created_at.desc',
    limit: byTaluk ? '50000' : '2000',
  });

  if (!byTaluk) {
    const days = period === 'monthly' ? 28 : 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    params.set('created_at', `gte.${cutoff}`);
  }

  if (district) params.set('district', `eq.${district}`);
  if (taluk) params.set('taluk', `eq.${taluk}`);
  // Prefer the stable ASN filter; `isp` (name) kept for backward compatibility.
  if (asn) params.set('asn', `eq.${asn}`);
  else if (isp) params.set('isp_name', `eq.${isp}`);
  if (connectionType) params.set('connection_type', `eq.${connectionType}`);

  const res = await supabase(`test_results?${params}`);

  if (!res.ok) {
    console.error('Supabase aggregate error', res.status);
    return jsonResponse({ error: 'Failed to fetch aggregates' }, 502);
  }

  const rows = (await res.json()) as TestResultRow[];
  if (!Array.isArray(rows)) {
    return jsonResponse({ error: 'Invalid aggregate response' }, 502);
  }

  return jsonResponse(aggregateTestResults(rows, byTaluk));
}

/** GET /v1/locate?lat=&lng= — which Kerala district/taluk a point is in.
 *
 * Clients send coordinates rounded to 2 dp (~1 km); we round again here and
 * never store or log them. Responses are cacheable because the rounded URL is
 * shared by everyone in the same ~1 km cell. */
function handleLocate(url: URL): Response {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return jsonResponse({ error: 'lat and lng are required numbers' }, 422);
  }
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const area = locateTaluk(round2(lat), round2(lng));
  return jsonResponse(area ?? { district: null, taluk: null }, 200, {
    'Cache-Control': 'public, max-age=86400',
  });
}

const UPDATE_SELECT =
  'id,brand_key,kind,status,message,eta,external_ref,created_at,updated_at,resolved_at,operators(name),operator_update_areas(district,taluk)';

/** Active operator updates covering an area (a taluk, or anywhere in a district
 *  when taluk is null). Errors are swallowed: "Right now" must still render. */
async function fetchActiveOperatorUpdates(
  env: Env,
  area: { district: string; taluk: string | null },
): Promise<ReturnType<typeof publicUpdate>[]> {
  const supabase = makeSupabase(env);
  if (!supabase) return [];
  try {
    const areaParams = new URLSearchParams({ select: 'update_id', district: `eq.${area.district}`, limit: '200' });
    if (area.taluk) areaParams.set('or', `(taluk.is.null,taluk.eq."${area.taluk}")`);
    const areasRes = await supabase(`operator_update_areas?${areaParams}`);
    if (!areasRes.ok) return [];
    const ids = [...new Set(((await areasRes.json()) as Array<{ update_id: string }>).map((r) => r.update_id))];
    if (!ids.length) return [];

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await supabase(
      `operator_updates?${new URLSearchParams({
        select: UPDATE_SELECT,
        id: `in.(${ids.join(',')})`,
        updated_at: `gte.${since}`,
        order: 'updated_at.desc',
        limit: '20',
      })}`,
    );
    if (!res.ok) return [];
    const now = new Date();
    return ((await res.json()) as UpdateRow[])
      .filter((u) => isVisibleUpdate(u, now))
      .map((u) => publicUpdate(u, displayNameForKey(u.brand_key)));
  } catch (err) {
    console.error('operator updates fetch failed', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Operator API (authenticated with per-operator bearer tokens)
// ---------------------------------------------------------------------------

// Best-effort per-isolate limit; operators are few and authenticated.
const operatorHits = new Map<string, { count: number; windowStart: number }>();
const OPERATOR_LIMIT_PER_MIN = 60;

function operatorRateLimited(operatorId: string): boolean {
  const now = Date.now();
  const entry = operatorHits.get(operatorId);
  if (!entry || now - entry.windowStart > 60_000) {
    operatorHits.set(operatorId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > OPERATOR_LIMIT_PER_MIN;
}

async function authenticateOperator(
  request: Request,
  env: Env,
): Promise<{ operator: OperatorRow } | { response: Response }> {
  const token = parseBearer(request.headers.get('Authorization'));
  if (!token) {
    return { response: jsonResponse({ error: 'Missing or malformed bearer token', field: 'Authorization' }, 401, { 'WWW-Authenticate': 'Bearer' }) };
  }
  const supabase = makeSupabase(env);
  if (!supabase) return { response: jsonResponse({ error: 'Supabase not configured' }, 503) };

  const res = await supabase(
    `operators?${new URLSearchParams({
      select: 'id,name,brand_key,allowed_districts,active',
      token_hash: `eq.${await sha256Hex(token)}`,
      active: 'eq.true',
      limit: '1',
    })}`,
  );
  if (!res.ok) return { response: jsonResponse({ error: 'Auth lookup failed' }, 502) };
  const [operator] = (await res.json()) as OperatorRow[];
  if (!operator) {
    return { response: jsonResponse({ error: 'Invalid or revoked token', field: 'Authorization' }, 401, { 'WWW-Authenticate': 'Bearer' }) };
  }
  if (operatorRateLimited(operator.id)) {
    return { response: jsonResponse({ error: `Rate limit: ${OPERATOR_LIMIT_PER_MIN} requests per minute` }, 429) };
  }
  return { operator };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function updateColumns(fields: UpdateFields): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (fields.status !== undefined) {
    cols.status = fields.status;
    cols.resolved_at = fields.status === 'restored' ? new Date().toISOString() : null;
  }
  if (fields.message !== undefined) cols.message = fields.message;
  if (fields.eta !== undefined) cols.eta = fields.eta;
  if (fields.kind !== undefined) cols.kind = fields.kind;
  if (fields.externalRef !== undefined) cols.external_ref = fields.externalRef;
  return cols;
}

async function replaceAreas(
  supabase: NonNullable<ReturnType<typeof makeSupabase>>,
  updateId: string,
  areas: AreaInput[],
): Promise<boolean> {
  const del = await supabase(`operator_update_areas?update_id=eq.${updateId}`, { method: 'DELETE' });
  if (!del.ok) return false;
  const ins = await supabase('operator_update_areas', {
    method: 'POST',
    body: JSON.stringify(areas.map((a) => ({ update_id: updateId, district: a.district, taluk: a.taluk }))),
    headers: { Prefer: 'return=minimal' },
  });
  return ins.ok;
}

async function loadOwnUpdate(
  supabase: NonNullable<ReturnType<typeof makeSupabase>>,
  operatorId: string,
  filter: Record<string, string>,
): Promise<UpdateRow | null> {
  const res = await supabase(
    `operator_updates?${new URLSearchParams({ select: UPDATE_SELECT, operator_id: `eq.${operatorId}`, limit: '1', ...filter })}`,
  );
  if (!res.ok) return null;
  const [row] = (await res.json()) as UpdateRow[];
  return row ?? null;
}

async function patchUpdate(
  supabase: NonNullable<ReturnType<typeof makeSupabase>>,
  operator: OperatorRow,
  updateId: string,
  fields: UpdateFields,
): Promise<Response> {
  const cols = { ...updateColumns(fields), updated_at: new Date().toISOString() };
  const res = await supabase(`operator_updates?id=eq.${updateId}&operator_id=eq.${operator.id}`, {
    method: 'PATCH',
    body: JSON.stringify(cols),
    headers: { Prefer: 'return=minimal' },
  });
  if (!res.ok) {
    console.error('operator update patch error', res.status, await res.text());
    return jsonResponse({ error: 'Failed to update' }, 502);
  }
  if (fields.areas && !(await replaceAreas(supabase, updateId, fields.areas))) {
    return jsonResponse({ error: 'Update saved but areas failed to save; retry with the same areas' }, 502);
  }
  const row = await loadOwnUpdate(supabase, operator.id, { id: `eq.${updateId}` });
  return jsonResponse({ update: row && publicUpdate(row, displayNameForKey(operator.brand_key)) });
}

/** POST /v1/operator/updates */
async function handleCreateOperatorUpdate(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateOperator(request, env);
  if ('response' in auth) return auth.response;
  const { operator } = auth;

  const body = await readJsonObject(request);
  if (!body) return jsonResponse({ error: 'Body must be a JSON object', field: 'body' }, 400);
  const v = validateCreate(body, operator);
  if (!v.ok) return jsonResponse({ error: v.error, field: v.field }, 422);

  const supabase = makeSupabase(env)!;

  // Idempotent retries: the same external_ref updates the existing record.
  if (v.fields.externalRef) {
    const existing = await loadOwnUpdate(supabase, operator.id, { external_ref: `eq.${v.fields.externalRef}` });
    if (existing) return patchUpdate(supabase, operator, existing.id, v.fields);
  }

  const insertRes = await supabase('operator_updates', {
    method: 'POST',
    body: JSON.stringify({ operator_id: operator.id, brand_key: operator.brand_key, ...updateColumns(v.fields) }),
    headers: { Prefer: 'return=representation' },
  });
  if (!insertRes.ok) {
    console.error('operator update insert error', insertRes.status, await insertRes.text());
    return jsonResponse({ error: 'Failed to create update' }, 502);
  }
  const [created] = (await insertRes.json()) as Array<{ id: string }>;
  if (!(await replaceAreas(supabase, created.id, v.fields.areas ?? []))) {
    await supabase(`operator_updates?id=eq.${created.id}`, { method: 'DELETE' });
    return jsonResponse({ error: 'Failed to save areas' }, 502);
  }
  const row = await loadOwnUpdate(supabase, operator.id, { id: `eq.${created.id}` });
  return jsonResponse({ update: row && publicUpdate(row, displayNameForKey(operator.brand_key)) }, 201);
}

/** PATCH /v1/operator/updates/:id */
async function handlePatchOperatorUpdate(id: string, request: Request, env: Env): Promise<Response> {
  const auth = await authenticateOperator(request, env);
  if ('response' in auth) return auth.response;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ error: 'Invalid update id', field: 'id' }, 400);

  const body = await readJsonObject(request);
  if (!body) return jsonResponse({ error: 'Body must be a JSON object', field: 'body' }, 400);
  const v = validatePatch(body, auth.operator);
  if (!v.ok) return jsonResponse({ error: v.error, field: v.field }, 422);

  const supabase = makeSupabase(env)!;
  const existing = await loadOwnUpdate(supabase, auth.operator.id, { id: `eq.${id}` });
  if (!existing) return jsonResponse({ error: 'Update not found', field: 'id' }, 404);
  return patchUpdate(supabase, auth.operator, id, v.fields);
}

/** GET /v1/operator/updates[?active=1] — this operator's own updates. */
async function handleListOperatorUpdates(url: URL, request: Request, env: Env): Promise<Response> {
  const auth = await authenticateOperator(request, env);
  if ('response' in auth) return auth.response;
  const supabase = makeSupabase(env)!;
  const res = await supabase(
    `operator_updates?${new URLSearchParams({
      select: UPDATE_SELECT,
      operator_id: `eq.${auth.operator.id}`,
      order: 'updated_at.desc',
      limit: '100',
    })}`,
  );
  if (!res.ok) return jsonResponse({ error: 'Failed to list updates' }, 502);
  const now = new Date();
  let rows = (await res.json()) as UpdateRow[];
  if (url.searchParams.get('active') === '1') rows = rows.filter((u) => isVisibleUpdate(u, now));
  const name = displayNameForKey(auth.operator.brand_key);
  return jsonResponse({
    operator: { name: auth.operator.name, brand_key: auth.operator.brand_key },
    updates: rows.map((u) => ({ ...publicUpdate(u, name), external_ref: u.external_ref ?? null, visible: isVisibleUpdate(u, now) })),
  });
}

/** POST /v1/reports — "Net illa?" outage report. No login; deduped and
 *  rate-limited per client token (and loosely per IP) inside one SQL call. */
async function handlePostReport(request: Request, env: Env): Promise<Response> {
  let body: ReportPayload;
  try {
    body = (await request.json()) as ReportPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const result = validateReport(body);
  if (!result.ok) return jsonResponse({ error: result.error, field: result.field }, 422);
  const r = result.report;

  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse({ error: 'Supabase not configured' }, 503);

  const cfg = outageConfig(env);
  const cf = request.cf as Record<string, unknown> | undefined;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const res = await supabase('rpc/submit_outage_report', {
    method: 'POST',
    body: JSON.stringify({
      p_district: r.district,
      p_taluk: r.taluk,
      p_village: r.village,
      p_brand_key: r.brandKey,
      p_provider_name: r.providerName,
      p_kind: r.kind,
      p_status: r.status,
      p_comment: r.comment,
      p_asn: typeof cf?.asn === 'number' ? cf.asn : null,
      p_ip_hash: await dailyIpHash(ip, env),
      p_token_hash: await tokenHash(r.clientToken, env),
      p_min_reports: cfg.minReports,
      p_window_min: cfg.windowMin,
    }),
  });
  if (!res.ok) {
    console.error('submit_outage_report error', res.status, await res.text());
    return jsonResponse({ error: 'Failed to save report' }, 502);
  }
  const out = (await res.json()) as {
    error?: string;
    report_id?: string;
    deduped?: boolean;
    reporters?: number;
    likely_outage?: boolean;
  };
  if (out.error === 'rate_limited') {
    return jsonResponse({ error: 'Too many reports from this device — try again later' }, 429);
  }
  return jsonResponse(
    {
      success: true,
      id: out.report_id,
      deduped: out.deduped ?? false,
      reporters: out.reporters ?? 1,
      likelyOutage: out.likely_outage ?? false,
    },
    out.deduped ? 200 : 201,
  );
}

const REPORT_COLUMNS =
  'district,taluk,village,brand_key,provider_name,kind,status,comment,last_seen_at,ip_hash,client_token_hash';
const EVENT_COLUMNS =
  'id,district,taluk,brand_key,provider_name,kind,started_at,last_report_at,report_count,peak_reporters,top_village';

/** GET /v1/status?district=&taluk= — the "Right now" section. Reports from the
 *  last RIGHT_NOW_WINDOW_MIN grouped by taluk + provider + kind, with live
 *  "Likely outage" flags and active operator updates. */
async function handleStatus(url: URL, env: Env): Promise<Response> {
  const district = url.searchParams.get('district') ?? '';
  const taluk = url.searchParams.get('taluk');
  if (!isKnownDistrict(district)) return jsonResponse({ error: 'Unknown district', field: 'district' }, 422);
  if (taluk && !isKnownTaluk(district, taluk)) return jsonResponse({ error: 'Unknown taluk', field: 'taluk' }, 422);

  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse({ error: 'Supabase not configured' }, 503);

  const cfg = outageConfig(env);
  const now = new Date();
  const since = new Date(now.getTime() - cfg.rightNowMin * 60_000).toISOString();

  const reportParams = new URLSearchParams({
    select: REPORT_COLUMNS,
    district: `eq.${district}`,
    hidden: 'eq.false',
    last_seen_at: `gte.${since}`,
    order: 'last_seen_at.desc',
    limit: '2000',
  });
  const eventParams = new URLSearchParams({
    select: EVENT_COLUMNS,
    district: `eq.${district}`,
    ended_at: 'is.null',
  });
  if (taluk) {
    reportParams.set('taluk', `eq.${taluk}`);
    eventParams.set('taluk', `eq.${taluk}`);
  }

  const [reportsRes, eventsRes, updates] = await Promise.all([
    supabase(`outage_reports?${reportParams}`),
    supabase(`outage_events?${eventParams}`),
    fetchActiveOperatorUpdates(env, { district, taluk }),
  ]);
  if (!reportsRes.ok || !eventsRes.ok) {
    console.error('status fetch error', reportsRes.status, eventsRes.status);
    return jsonResponse({ error: 'Failed to fetch status' }, 502);
  }

  const { groups, comments } = buildStatus(
    (await reportsRes.json()) as ReportRow[],
    (await eventsRes.json()) as EventRow[],
    { now, outageWindowMin: cfg.windowMin },
  );

  return jsonResponse(
    {
      generated_at: now.toISOString(),
      district,
      taluk: taluk ?? null,
      window_min: cfg.rightNowMin,
      outage_window_min: cfg.windowMin,
      outage_min_reports: cfg.minReports,
      groups,
      comments,
      operator_updates: updates,
    },
    200,
    { 'Cache-Control': 'public, max-age=30' },
  );
}

/** GET /v1/outages/active — every live "Likely outage" across Kerala, for the
 *  homepage. */
async function handleActiveOutages(env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse({ error: 'Supabase not configured' }, 503);

  const cfg = outageConfig(env);
  const now = new Date();
  const fresh = new Date(now.getTime() - cfg.windowMin * 60_000).toISOString();

  const eventsRes = await supabase(
    `outage_events?${new URLSearchParams({
      select: EVENT_COLUMNS,
      ended_at: 'is.null',
      last_report_at: `gte.${fresh}`,
      order: 'last_report_at.desc',
      limit: '100',
    })}`,
  );
  if (!eventsRes.ok) {
    console.error('active outages fetch error', eventsRes.status);
    return jsonResponse({ error: 'Failed to fetch outages' }, 502);
  }
  const events = (await eventsRes.json()) as EventRow[];

  // Reports in the detection window for the affected taluks, for live counts.
  let reports: ReportRow[] = [];
  if (events.length) {
    const districts = [...new Set(events.map((e) => e.district))];
    const reportsRes = await supabase(
      `outage_reports?${new URLSearchParams({
        select: REPORT_COLUMNS,
        district: `in.(${districts.map((d) => `"${d}"`).join(',')})`,
        hidden: 'eq.false',
        last_seen_at: `gte.${fresh}`,
        limit: '5000',
      })}`,
    );
    if (reportsRes.ok) reports = (await reportsRes.json()) as ReportRow[];
  }

  const { groups } = buildStatus(reports, events, { now, outageWindowMin: cfg.windowMin });
  return jsonResponse(
    {
      generated_at: now.toISOString(),
      window_min: cfg.windowMin,
      outages: groups.filter((g) => g.likely_outage),
    },
    200,
    { 'Cache-Control': 'public, max-age=30' },
  );
}

/** Close outage events with no reports for a full detection window. */
async function closeStaleOutages(env: Env): Promise<void> {
  const supabase = makeSupabase(env);
  if (!supabase) return;
  const res = await supabase('rpc/close_stale_outage_events', {
    method: 'POST',
    body: JSON.stringify({ p_window_min: outageConfig(env).windowMin }),
  });
  if (!res.ok) console.error('close_stale_outage_events error', res.status, await res.text());
}

/** GET /v1/points — public, located results for the live map. */
async function handlePoints(url: URL, env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse({ error: 'Supabase not configured' }, 503);
  }

  const params = new URLSearchParams({
    // Includes both netundo and source='mlab' points (frontend styles them
    // distinctly) so the live map shows independent measurements too.
    select: 'lat,lng,download_mbps,upload_mbps,latency_ms,isp_name,asn,district,connection_type,source,created_at',
    consent_public: 'eq.true',
    is_outlier: 'eq.false',
    lat: 'not.is.null',
    order: 'created_at.desc',
    limit: '2000',
  });

  const connectionType = url.searchParams.get('connection_type');
  if (connectionType) params.set('connection_type', `eq.${connectionType}`);

  const res = await supabase(`test_results?${params}`);
  if (!res.ok) {
    console.error('Supabase points error', res.status);
    return jsonResponse({ error: 'Failed to fetch points' }, 502);
  }

  const rows = await res.json();
  return jsonResponse(Array.isArray(rows) ? rows : []);
}

/** GET /v1/trai — official TRAI MySpeed Kerala mobile baseline (latest month).
 *  Third-party reference data; kept entirely separate from /v1/aggregate. */
async function handleTrai(env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse({ period: null, source: null, operators: [] }, 503);
  }

  const params = new URLSearchParams({
    select: 'period,operator,technology,direction,avg_mbps,sample_count,source',
    lsa: 'eq.Kerala',
    order: 'period.desc',
    limit: '300',
  });

  const res = await supabase(`trai_benchmarks?${params}`);
  if (!res.ok) {
    console.error('Supabase trai error', res.status);
    return jsonResponse({ error: 'Failed to fetch TRAI benchmark' }, 502);
  }

  const rows = (await res.json()) as TraiRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ period: null, source: null, operators: [] });
  }

  // Rows are period-desc, so the first row's period is the most recent month.
  const latest = rows[0].period;
  const current = rows.filter((r) => r.period === latest);

  return jsonResponse({
    period: latest,
    source: current[0]?.source ?? 'TRAI MySpeed (data.gov.in, NDSAP)',
    operators: current,
  });
}

/** GET /v1/mlab — independent M-Lab benchmark rows (district + taluk).
 *  Third-party CC0 reference data; kept separate from /v1/aggregate. */
async function handleMlab(env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse([], 503);

  const params = new URLSearchParams({
    select:
      'geo_level,district,taluk,mlab_locality,match_type,period,download_mbps,upload_mbps,latency_ms,sample_count,source',
    order: 'district.asc',
    limit: '500',
  });

  const res = await supabase(`mlab_benchmarks?${params}`);
  if (!res.ok) {
    console.error('Supabase mlab error', res.status);
    return jsonResponse({ error: 'Failed to fetch M-Lab data' }, 502);
  }

  const rows = await res.json();
  return jsonResponse(Array.isArray(rows) ? rows : []);
}

/** GET /v1/ookla — Speedtest® by Ookla® Open Data benchmark rows (district + taluk).
 *  Third-party CC BY-NC-SA reference data; kept separate from /v1/aggregate. */
async function handleOokla(env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) return jsonResponse([], 503);

  const params = new URLSearchParams({
    select:
      'geo_level,district,taluk,conn_type,period,download_mbps,upload_mbps,latency_ms,tests,tile_count,source',
    order: 'district.asc',
    limit: '1000',
  });

  const res = await supabase(`ookla_benchmarks?${params}`);
  if (!res.ok) {
    console.error('Supabase ookla error', res.status);
    return jsonResponse({ error: 'Failed to fetch Ookla data' }, 502);
  }

  const rows = await res.json();
  return jsonResponse(Array.isArray(rows) ? rows : []);
}

interface FeedbackPayload {
  category?: string;
  message?: string;
  email?: string;
  district?: string;
  pageUrl?: string;
}

const FEEDBACK_CATEGORIES: Set<string> = new Set(['bug', 'feature', 'data', 'general']);

/** POST /v1/feedback — public feedback / bug reports from the website. */
async function handlePostFeedback(request: Request, env: Env): Promise<Response> {
  let payload: FeedbackPayload;
  try {
    payload = (await request.json()) as FeedbackPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const category = typeof payload.category === 'string' ? payload.category : '';
  if (!FEEDBACK_CATEGORIES.has(category)) {
    return jsonResponse({ error: 'category must be bug, feature, data, or general' }, 422);
  }

  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (message.length < 3) {
    return jsonResponse({ error: 'message is required' }, 422);
  }
  if (message.length > 4000) {
    return jsonResponse({ error: 'message is too long (max 4000 chars)' }, 422);
  }

  const email =
    typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim().slice(0, 320)
      : null;
  const district =
    typeof payload.district === 'string' && payload.district.trim()
      ? payload.district.trim().slice(0, 120)
      : null;
  const pageUrl =
    typeof payload.pageUrl === 'string' && payload.pageUrl.trim()
      ? payload.pageUrl.trim().slice(0, 500)
      : null;

  // --- Rate limiting (shares the same 10/hour budget keyed by IP hash) ---
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(ip);
  if (await isRateLimited(ipHash)) {
    return jsonResponse({ error: 'Rate limit exceeded: please try again later' }, 429);
  }

  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse(
      { error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.' },
      503,
    );
  }

  const insertRes = await supabase('feedback', {
    method: 'POST',
    body: JSON.stringify({
      category,
      message,
      email,
      district,
      page_url: pageUrl,
      user_agent: request.headers.get('User-Agent'),
      ip_hash: ipHash,
    }),
    headers: { Prefer: 'return=minimal' },
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error('Supabase feedback insert error', insertRes.status, errText);
    return jsonResponse({ error: 'Failed to store feedback' }, 502);
  }

  return jsonResponse({ success: true }, 201);
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;

    // Pre-flight
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // Health
    if (method === 'GET' && (path === '/v1/health' || path === '/health')) {
      return handleHealth(request);
    }

    // POST /v1/results
    if (method === 'POST' && path === '/v1/results') {
      return handlePostResult(request, env);
    }

    // POST /v1/feedback
    if (method === 'POST' && path === '/v1/feedback') {
      return handlePostFeedback(request, env);
    }

    // PATCH /v1/results/:id/provider
    const providerMatch = path.match(/^\/v1\/results\/([^/]+)\/provider$/);
    if (method === 'PATCH' && providerMatch) {
      return handlePatchProvider(providerMatch[1], request, env);
    }

    // GET /v1/results/:id
    const resultMatch = path.match(/^\/v1\/results\/([^/]+)$/);
    if (method === 'GET' && resultMatch) {
      return handleGetResult(resultMatch[1], env);
    }

    // GET /v1/aggregate
    if (method === 'GET' && path === '/v1/aggregate') {
      return handleAggregate(url, env);
    }

    // GET /v1/locate
    if (method === 'GET' && path === '/v1/locate') {
      return handleLocate(url);
    }

    // Outage reporting
    if (method === 'POST' && path === '/v1/reports') {
      return handlePostReport(request, env);
    }
    if (method === 'GET' && path === '/v1/status') {
      return handleStatus(url, env);
    }
    if (method === 'GET' && path === '/v1/outages/active') {
      return handleActiveOutages(env);
    }

    // Operator updates API
    if (path === '/v1/operator/updates') {
      if (method === 'POST') return handleCreateOperatorUpdate(request, env);
      if (method === 'GET') return handleListOperatorUpdates(url, request, env);
    }
    const opUpdateMatch = path.match(/^\/v1\/operator\/updates\/([^/]+)$/);
    if (method === 'PATCH' && opUpdateMatch) {
      return handlePatchOperatorUpdate(opUpdateMatch[1], request, env);
    }

    // GET /v1/points
    if (method === 'GET' && path === '/v1/points') {
      return handlePoints(url, env);
    }

    // GET /v1/trai
    if (method === 'GET' && path === '/v1/trai') {
      return handleTrai(env);
    }

    // GET /v1/mlab
    if (method === 'GET' && path === '/v1/mlab') {
      return handleMlab(env);
    }

    // GET /v1/ookla
    if (method === 'GET' && path === '/v1/ookla') {
      return handleOokla(env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(closeStaleOutages(env));
  },
} satisfies ExportedHandler<Env>;
