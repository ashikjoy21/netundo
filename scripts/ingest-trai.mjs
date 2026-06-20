#!/usr/bin/env node
/**
 * ingest-trai.mjs — pull TRAI MySpeed mobile speed data for Kerala from the
 * data.gov.in Open Government Data API and upsert per-operator monthly averages
 * into the `trai_benchmarks` table.
 *
 * This is an OFFICIAL BENCHMARK ingest only. The data lands in its own table and
 * is never blended into test_results / aggregate_district_isp (see migration 006).
 *
 * Source licence: NDSAP (data.gov.in) — commercial use permitted with attribution.
 *
 * Usage:
 *   node scripts/ingest-trai.mjs --resource-id <uuid> [--period YYYY-MM] [--dry-run]
 *
 * Env (see .env.example):
 *   DATA_GOV_API_KEY        data.gov.in API key
 *   SUPABASE_URL            Supabase project URL
 *   SUPABASE_SERVICE_KEY    Supabase service-role key (write access)
 *
 * Zero-dependency: uses Node 18+ global fetch. Exits non-zero on failure (no
 * silent fallback to stale data).
 */

const DATA_GOV_BASE = 'https://api.data.gov.in/resource';
const PAGE_LIMIT = 1000; // data.gov.in max rows per request
const LSA = 'Kerala';

// --- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--resource-id') args.resourceId = argv[++i];
    else if (a === '--period') args.period = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/**
 * Resolve the dataset period to { date: 'YYYY-MM-01', year, month }.
 * The TRAI resource is one giant multi-year table, so we must filter by year AND
 * month — without it we would average across every month ever published.
 * Defaults to the previous calendar month.
 */
function resolvePeriod(period) {
  let year;
  let month; // 1-12
  if (period) {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error(`--period must be YYYY-MM, got: ${period}`);
    }
    [year, month] = period.split('-').map(Number);
  } else {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
  }
  return { date: `${year}-${String(month).padStart(2, '0')}-01`, year, month };
}

// --- field normalisation ---------------------------------------------------

/** Find a value in a record by fuzzy (case/space/underscore-insensitive) key match. */
function pick(record, candidates) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = new Map(Object.keys(record).map((k) => [norm(k), record[k]]));
  for (const c of candidates) {
    const v = map.get(norm(c));
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const OPERATOR_ALIASES = [
  [/jio|reliance/i, 'Jio'],
  [/airtel|bharti/i, 'Airtel'],
  [/\bvi\b|vodafone|idea/i, 'Vi'],
  [/bsnl|cellone|cell one/i, 'BSNL'], // CELLONE is BSNL's mobile brand
  [/mtnl/i, 'MTNL'],
];

/** Canonicalise a raw provider string to a stable display name. */
function canonicalOperator(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  for (const [re, name] of OPERATOR_ALIASES) {
    if (re.test(s)) return name;
  }
  return s; // keep unknown providers verbatim rather than dropping them
}

function canonicalTechnology(raw) {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('5G')) return '5G';
  if (s.includes('4G') || s.includes('LTE')) return '4G';
  if (s.includes('3G')) return '3G';
  return null;
}

function canonicalDirection(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('down')) return 'download';
  if (s.includes('up')) return 'upload';
  return null;
}

// --- aggregation (pure, testable) ------------------------------------------

/**
 * Reduce raw TRAI sample rows to per-(operator,technology,direction) averages.
 * Speed is converted from Kbps to Mbps. Returns rows ready to upsert.
 */
export function aggregateTraiRows(rawRows, period, lsa = LSA) {
  const groups = new Map();

  for (const r of rawRows) {
    const operator = canonicalOperator(pick(r, ['operator', 'service provider', 'provider']));
    const technology = canonicalTechnology(pick(r, ['technology', 'network technology']));
    // The TRAI schema names the direction column "download"; its VALUE is
    // 'download' or 'upload'. Fall back to the older 'test type' naming too.
    const direction = canonicalDirection(pick(r, ['download', 'test type', 'test_type', 'type', 'direction']));
    const kbps = Number(pick(r, ['speed_kbps', 'data speed(kbps)', 'data speed', 'data_speed', 'speed']));

    if (!operator || !technology || !direction || !Number.isFinite(kbps) || kbps <= 0) {
      continue; // skip malformed / unparseable samples
    }

    const key = `${operator}|${technology}|${direction}`;
    const g = groups.get(key);
    if (g) {
      g.sum += kbps;
      g.count += 1;
    } else {
      groups.set(key, { operator, technology, direction, sum: kbps, count: 1 });
    }
  }

  return [...groups.values()].map((g) => ({
    period,
    lsa,
    operator: g.operator,
    technology: g.technology,
    direction: g.direction,
    avg_mbps: Number((g.sum / g.count / 1000).toFixed(3)),
    sample_count: g.count,
  }));
}

// --- data.gov.in fetch ------------------------------------------------------

/** fetch with retry + backoff — data.gov.in occasionally drops connections. */
async function fetchWithRetry(url, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        throw new Error(`data.gov.in returned ${res.status}: ${await res.text()}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = 1000 * 2 ** i; // 1s, 2s, 4s
        console.warn(`  fetch attempt ${i + 1} failed (${err.message}); retrying in ${wait}ms…`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function fetchAllKeralaRows(resourceId, apiKey, year, month) {
  const rows = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${DATA_GOV_BASE}/${resourceId}`);
    url.searchParams.set('api-key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    // Server-side filters. The resource spans every month/year, so year+month are
    // essential. We also filter defensively client-side in case the server ignores
    // any filter (which would otherwise average across the entire history).
    url.searchParams.set('filters[lsa]', LSA);
    url.searchParams.set('filters[year]', String(year));
    url.searchParams.set('filters[month]', String(month));

    const res = await fetchWithRetry(url);
    const body = await res.json();
    const batch = Array.isArray(body.records) ? body.records : [];

    for (const r of batch) {
      const lsa = pick(r, ['lsa', 'circle', 'service area']);
      const rowYear = Number(pick(r, ['year']));
      const rowMonth = Number(pick(r, ['month']));
      const lsaOk = !lsa || String(lsa).toLowerCase().includes('kerala');
      const periodOk = rowYear === year && rowMonth === month;
      if (lsaOk && periodOk) rows.push(r);
    }

    if (batch.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return rows;
}

// --- Supabase upsert --------------------------------------------------------

async function upsertBenchmarks(supabaseUrl, serviceKey, rows) {
  const res = await fetch(`${supabaseUrl}/rest/v1/trai_benchmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      // Upsert on the unique(period,lsa,operator,technology,direction) constraint.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase upsert failed ${res.status}: ${await res.text()}`);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (!args.resourceId) {
    throw new Error('Missing --resource-id (the data.gov.in TRAI MySpeed resource UUID)');
  }

  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) throw new Error('DATA_GOV_API_KEY is not set');

  const { date, year, month } = resolvePeriod(args.period);

  console.log(`Fetching TRAI MySpeed (${LSA}) resource ${args.resourceId} for ${date} (${year}-${month})…`);
  const rawRows = await fetchAllKeralaRows(args.resourceId, apiKey, year, month);
  console.log(`  fetched ${rawRows.length} raw Kerala samples`);

  const benchmarks = aggregateTraiRows(rawRows, date);
  if (benchmarks.length === 0) {
    throw new Error('No usable benchmark rows after aggregation — aborting (check resource-id/schema)');
  }

  console.log(`  aggregated into ${benchmarks.length} operator/tech/direction rows:`);
  for (const b of benchmarks) {
    console.log(`    ${b.operator} ${b.technology} ${b.direction}: ${b.avg_mbps} Mbps (n=${b.sample_count})`);
  }

  if (args.dryRun) {
    console.log('Dry run — not writing to Supabase.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to write');
  }

  await upsertBenchmarks(supabaseUrl, serviceKey, benchmarks);
  console.log(`Upserted ${benchmarks.length} rows into trai_benchmarks for ${date}.`);
}

// Only run main() when invoked directly (allows importing aggregateTraiRows in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('ingest-trai failed:', err.message);
    process.exit(1);
  });
}
