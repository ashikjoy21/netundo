/**
 * netundo-api — Cloudflare Worker
 *
 * Results ingestion and aggregation API.
 * Routes:
 *   POST /v1/results
 *   GET  /v1/results/:id
 *   GET  /v1/aggregate
 *   GET  /v1/health
 */

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    lat?: number;
    lng?: number;
    accuracyM?: number;
  };
  plan?: {
    advertisedMbps?: number;
  };
  consent: {
    sharePublicly: boolean;
    shareExactLocation: boolean;
  };
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

/** SHA-256 of IP + salt, returned as hex string */
async function hashIp(ip: string, salt = 'netundo-v1'): Promise<string> {
  const data = new TextEncoder().encode(ip + salt);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

/** Percentile on a sorted numeric array (linear interpolation). */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
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

/** GET /v1/aggregate */
async function handleAggregate(url: URL, env: Env): Promise<Response> {
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

/** GET /v1/points — public, located results for the live map. */
async function handlePoints(url: URL, env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse({ error: 'Supabase not configured' }, 503);
  }

  const params = new URLSearchParams({
    select: 'lat,lng,download_mbps,upload_mbps,latency_ms,isp_name,asn,district,connection_type,created_at',
    consent_public: 'eq.true',
    is_outlier: 'eq.false',
    lat: 'not.is.null',
    order: 'created_at.desc',
    limit: '500',
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

    // GET /v1/results/:id
    const resultMatch = path.match(/^\/v1\/results\/([^/]+)$/);
    if (method === 'GET' && resultMatch) {
      return handleGetResult(resultMatch[1], env);
    }

    // GET /v1/aggregate
    if (method === 'GET' && path === '/v1/aggregate') {
      return handleAggregate(url, env);
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

    return jsonResponse({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
