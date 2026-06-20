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

/** First of the month (YYYY-MM-01) for the dataset period. Defaults to last month. */
function resolvePeriod(period) {
  if (period) {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error(`--period must be YYYY-MM, got: ${period}`);
    }
    return `${period}-01`;
  }
  const now = new Date();
  // TRAI publishes a month or two behind; default to the previous calendar month.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
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
  [/bsnl/i, 'BSNL'],
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
    const operator = canonicalOperator(pick(r, ['service provider', 'operator', 'provider']));
    const technology = canonicalTechnology(pick(r, ['technology', 'network technology']));
    const direction = canonicalDirection(pick(r, ['test type', 'type', 'direction']));
    const kbps = Number(pick(r, ['data speed(kbps)', 'data speed', 'speed', 'data_speed']));

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

async function fetchAllKeralaRows(resourceId, apiKey) {
  const rows = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${DATA_GOV_BASE}/${resourceId}`);
    url.searchParams.set('api-key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    // Server-side filter to the Kerala circle. Field key casing varies across
    // datasets, so we also filter defensively below.
    url.searchParams.set('filters[lsa]', LSA);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`data.gov.in returned ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    const batch = Array.isArray(body.records) ? body.records : [];

    // Defensive client-side LSA filter in case the server filter was ignored.
    for (const r of batch) {
      const lsa = pick(r, ['lsa', 'circle', 'service area']);
      if (!lsa || String(lsa).toLowerCase().includes('kerala')) rows.push(r);
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

  const period = resolvePeriod(args.period);

  console.log(`Fetching TRAI MySpeed (${LSA}) resource ${args.resourceId} for ${period}…`);
  const rawRows = await fetchAllKeralaRows(args.resourceId, apiKey);
  console.log(`  fetched ${rawRows.length} raw Kerala samples`);

  const benchmarks = aggregateTraiRows(rawRows, period);
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
  console.log(`Upserted ${benchmarks.length} rows into trai_benchmarks for ${period}.`);
}

// Only run main() when invoked directly (allows importing aggregateTraiRows in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('ingest-trai failed:', err.message);
    process.exit(1);
  });
}
