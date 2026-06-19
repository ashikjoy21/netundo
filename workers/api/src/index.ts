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
  DB: D1Database; // D1 binding (unused in MVP — Supabase is primary store)
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

/** GET /v1/health */
function handleHealth(): Response {
  return jsonResponse({ status: 'ok' });
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
  const cf = request.cf as Record<string, unknown> | undefined;
  const asn = typeof cf?.asn === 'number' ? cf.asn : null;
  const ispOrg = typeof cf?.organization === 'string' ? cf.organization : null;
  const colo = typeof cf?.colo === 'string' ? cf.colo : null;

  // --- Build DB row ---
  const id = uuidv4();
  const { summary, scores, client, location, consent } = payload;

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

    // Kerala location
    district: location.district,
    taluk: location.taluk ?? null,
    // PostGIS geography point — only stored when consent given
    location:
      consent.shareExactLocation &&
      typeof location.lat === 'number' &&
      typeof location.lng === 'number'
        ? `POINT(${location.lng} ${location.lat})`
        : null,
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

/** GET /v1/aggregate */
async function handleAggregate(url: URL, env: Env): Promise<Response> {
  const supabase = makeSupabase(env);
  if (!supabase) {
    return jsonResponse(
      { error: 'Supabase not configured' },
      503,
    );
  }

  const params = new URLSearchParams({ select: '*' });

  const district = url.searchParams.get('district');
  const isp = url.searchParams.get('isp');
  const connectionType = url.searchParams.get('connection_type');
  const period = url.searchParams.get('period'); // 'weekly' | 'monthly'

  if (district) params.set('district', `eq.${district}`);
  if (isp) params.set('isp_name', `eq.${isp}`);
  if (connectionType) params.set('connection_type', `eq.${connectionType}`);

  // The materialized view stores week-truncated dates; for monthly we rely on
  // the caller grouping multiple weeks, or a future monthly view.
  if (period === 'monthly') {
    // Return last ~4 weeks
    const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    params.set('period', `gte.${cutoff}`);
  } else if (period === 'weekly' || !period) {
    // Default: last week
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    params.set('period', `gte.${cutoff}`);
  }

  // Limit sensible result set size
  params.set('limit', '500');

  const res = await supabase(`aggregate_district_isp?${params}`);

  if (!res.ok) {
    console.error('Supabase aggregate error', res.status);
    return jsonResponse({ error: 'Failed to fetch aggregates' }, 502);
  }

  const data = await res.json();
  return jsonResponse(data);
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
      return handleHealth();
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

    return jsonResponse({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
