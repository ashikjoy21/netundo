/**
 * netundo-speedtest — Cloudflare Worker
 *
 * Measurement endpoints for the @cloudflare/speedtest engine.
 * Routes: GET /down, POST /up, GET /health, OPTIONS *
 */

// The @cloudflare/speedtest default profile requests up to 250 MB per download
// chunk. Capping below that would truncate large transfers and UNDER-report fast
// connections, so the cap must sit above the largest measurement (250 MB).
const MAX_BYTES = 300_000_000; // 300 MB hard cap (covers the 250 MB measurement)
const DEFAULT_BYTES = 1_000_000; // 1 MB default

// CORS headers applied to every response
const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// Standard measurement headers expected by the speedtest engine
const MEASUREMENT_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store',
  'Server-Timing': 'cf_time;dur=0',
};

function baseHeaders(extra?: HeadersInit): Headers {
  return new Headers({
    ...CORS_HEADERS,
    ...MEASUREMENT_HEADERS,
    ...extra,
  });
}

/** Handle CORS pre-flight for any path */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: new Headers(CORS_HEADERS),
  });
}

/**
 * GET /down?bytes=N
 *
 * Streams exactly N bytes of zeroed binary data.  Using a ReadableStream
 * avoids materialising the entire buffer in memory for large payloads.
 */
function handleDownload(url: URL): Response {
  const raw = parseInt(url.searchParams.get('bytes') ?? '', 10);
  const bytes = Number.isFinite(raw) && raw > 0
    ? Math.min(raw, MAX_BYTES)
    : DEFAULT_BYTES;

  // Chunk size kept at 64 KiB — small enough to avoid single large allocs,
  // large enough to stay efficient.
  const CHUNK = 65_536;

  const stream = new ReadableStream({
    start(controller) {
      let remaining = bytes;
      while (remaining > 0) {
        const size = Math.min(CHUNK, remaining);
        const chunk = new Uint8Array(size);
        crypto.getRandomValues(chunk); // random bytes — not compressible
        controller.enqueue(chunk);
        remaining -= size;
      }
      controller.close();
    },
  });

  const headers = baseHeaders({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes),
  });

  return new Response(stream, { status: 200, headers });
}

/**
 * POST /up
 *
 * Accepts any body upload and discards it, then returns 200 empty.
 * The body must be consumed (or the runtime may not charge the full
 * upload time against the connection).
 */
async function handleUpload(request: Request): Promise<Response> {
  // Drain the body so the TCP window stays open for the full upload
  if (request.body) {
    const reader = request.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }

  return new Response(null, {
    status: 200,
    headers: baseHeaders(),
  });
}

/**
 * GET / or GET /health
 *
 * Returns basic edge metadata for diagnostics.
 */
function handleHealth(request: Request): Response {
  const cf = request.cf as Record<string, unknown> | undefined;

  const body = JSON.stringify({
    status: 'ok',
    colo: cf?.colo ?? null,
    city: cf?.city ?? null,
  });

  return new Response(body, {
    status: 200,
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { method, } = request;
    const path = url.pathname;

    // Pre-flight
    if (method === 'OPTIONS') {
      return handleOptions();
    }

    // Download measurement.
    // `/__down` is the path the @cloudflare/speedtest engine requests by default;
    // `/down` is kept as a friendly alias. Both must work for a drop-in self-host.
    if (method === 'GET' && (path === '/__down' || path === '/down')) {
      return handleDownload(url);
    }

    // Upload measurement (`/__up` is the engine's default path).
    if (method === 'POST' && (path === '/__up' || path === '/up')) {
      return handleUpload(request);
    }

    // Health / root
    if (method === 'GET' && (path === '/' || path === '/health')) {
      return handleHealth(request);
    }

    // 404 for everything else
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
    });
  },
} satisfies ExportedHandler;
