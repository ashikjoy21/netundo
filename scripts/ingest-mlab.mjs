#!/usr/bin/env node
/**
 * ingest-mlab.mjs — pull M-Lab (Measurement Lab) aggregated speed statistics for
 * Kerala localities and upsert them into the `mlab_benchmarks` table.
 *
 * M-Lab publishes daily NDT aggregates per locality (town) under a public-domain
 * CC0 licence — commercially safe to reuse with no attribution required (we credit
 * it anyway). Data: https://statistics.measurementlab.net/v0/AS/IN/IN-KL/...
 *
 * Like the TRAI ingest, this is a LABELLED THIRD-PARTY layer. It lands in its own
 * table and is NEVER blended into test_results / aggregate_district_isp:
 *   * Methodology differs (single-stream NDT vs our Cloudflare multi-stream).
 *   * Geolocation is IP-based (~city accuracy) — we attribute to a town, not GPS.
 * It is shown as "Independent measurements (M-Lab)" alongside our own numbers.
 *
 * Geographic model: M-Lab has no "district" aggregate — only town localities. So:
 *   * district page  -> the same-named principal city (e.g. Ernakulam, Kollam)
 *   * taluk page     -> exact name, a curated transliteration alias, or the
 *                       taluk's main town (HQ fallback, clearly labelled)
 *
 * Usage:
 *   node scripts/ingest-mlab.mjs [--year 2024] [--dry-run] [--only <taluk|district>]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (omit for --dry-run).
 */

import fs from 'fs';

const BASE = 'https://statistics.measurementlab.net/v0/AS/IN/IN-KL';
const PLACES_FILE = new URL('../apps/web/src/lib/keralaPlaces.ts', import.meta.url);
const PREFERRED_YEARS = [2024, 2023, 2022]; // newest first; fall back if a place lacks recent data
// Don't store a locality whose yearly average rests on too few samples — a handful
// of tests yields wild numbers (e.g. "109 Mbps from 1 test"). 50 drops the worst noise.
const MIN_SAMPLES = 50;

// --- Curated taluk → M-Lab locality map (signed off 2026-06) ----------------
// Exact matches need no entry — the script tries the taluk name verbatim first.

// Transliteration / old-name aliases (Tier 1 + Tier 2). Same place, different spelling.
const TALUK_ALIAS = {
  Chirayinkeezh: 'Chirayinkeezhu',
  Kottarakkara: 'Kottarakara',
  Thiruvalla: 'Tiruvalla',
  Ambalappuzha: 'Ambalapuzha',
  Changanassery: 'Changanacheri',
  Vaikom: 'Vaikam',
  Devikulam: 'Devikolam',
  Kanayannor: 'Kanayannur',
  Moovattupuzha: 'Muvattupuzha',
  Perinthalmanna: 'Perintalmanna',
  Vatakara: 'Badagara',
  Mananthavady: 'Manantoddy',
  Payyannur: 'Payyanur',
  Manjeswaram: 'Manjeshvar',
  Peerumade: 'Pirmed',
  Konni: 'Koni',
  Chalakkudy: 'Kizhake Chalakudi',
  'Sulthan Bathery': 'Ganapathivattam',
};

// Headquarters-town fallback (Tier 3). The taluk page shows its main town's data,
// labelled honestly as such (match_type='hq_town').
const TALUK_HQ = {
  Meenachil: 'Pala',
  Udumbanchola: 'Nedumkandam',
  Kunnathunad: 'Perumbavoor',
  Mukundapuram: 'Irinjalakuda',
  Ernad: 'Manjeri',
  Hosdurg: 'Kanhangad',
  Chavakkad: 'Guruvayur',
};

// --- parse netundo districts/taluks ----------------------------------------

function loadPlaces() {
  const src = fs.readFileSync(PLACES_FILE, 'utf8');
  const bs = src.indexOf('{', src.indexOf('KERALA_VILLAGES'));
  let depth = 0;
  let end = -1;
  for (let i = bs; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  // eslint-disable-next-line no-eval
  return eval('(' + src.slice(bs, end + 1) + ')');
}

// --- M-Lab fetch + aggregation ---------------------------------------------

async function fetchJson(url, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

/** Fetch the newest available yearly histogram for a locality. */
async function fetchLocality(name, yearArg) {
  const years = yearArg ? [Number(yearArg)] : PREFERRED_YEARS;
  for (const year of years) {
    const url = `${BASE}/${encodeURIComponent(name)}/${year}/histogram_daily_stats.json`;
    const rows = await fetchJson(url);
    if (Array.isArray(rows) && rows.length) return { year, rows };
  }
  return null;
}

/**
 * Reduce daily histogram rows to one representative summary.
 * The file repeats the daily aggregate across histogram buckets, so we dedup by
 * date, then take the sample-weighted mean of the daily MEDIANS — a robust
 * "typical" figure for the period.
 */
export function summarizeLocality(rows, year) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) {
      byDate.set(r.date, {
        dl: Number(r.download_MED),
        ul: Number(r.upload_MED),
        rtt: Number(r.download_minRTT_MED),
        n: Number(r.dl_samples_day) || 0,
      });
    }
  }
  const days = [...byDate.values()].filter((d) => d.n > 0);
  if (!days.length) return null;

  const wmean = (field) => {
    let sum = 0;
    let w = 0;
    for (const d of days) {
      if (Number.isFinite(d[field])) { sum += d[field] * d.n; w += d.n; }
    }
    return w ? sum / w : null;
  };

  const totalSamples = days.reduce((s, d) => s + d.n, 0);
  return {
    period: `${year}-01-01`,
    download_mbps: round(wmean('dl')),
    upload_mbps: round(wmean('ul')),
    latency_ms: round(wmean('rtt')),
    sample_count: totalSamples,
  };
}

const round = (v) => (v == null ? null : Number(v.toFixed(2)));

// --- build the work list ----------------------------------------------------

function buildTargets(KERALA) {
  const targets = [];

  // Districts → principal city (same-named locality).
  for (const district of Object.keys(KERALA)) {
    targets.push({ geo_level: 'district', district, taluk: null, mlab: district, match_type: 'exact' });
  }

  // Taluks → exact name / alias / HQ-town.
  for (const district of Object.keys(KERALA)) {
    for (const taluk of Object.keys(KERALA[district])) {
      let mlab = taluk;
      let match_type = 'exact';
      if (TALUK_ALIAS[taluk]) { mlab = TALUK_ALIAS[taluk]; match_type = 'alias'; }
      else if (TALUK_HQ[taluk]) { mlab = TALUK_HQ[taluk]; match_type = 'hq_town'; }
      targets.push({ geo_level: 'taluk', district, taluk, mlab, match_type });
    }
  }
  return targets;
}

// --- Supabase upsert --------------------------------------------------------

async function upsert(supabaseUrl, serviceKey, rows) {
  // Chunk to keep request bodies reasonable.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await fetch(`${supabaseUrl}/rest/v1/mlab_benchmarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`Supabase upsert failed ${res.status}: ${await res.text()}`);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const yearArg = args.includes('--year') ? args[args.indexOf('--year') + 1] : null;
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

  const KERALA = loadPlaces();
  let targets = buildTargets(KERALA);
  if (only) targets = targets.filter((t) => t.taluk === only || t.district === only);

  console.log(`Resolving ${targets.length} M-Lab targets (districts + taluks)…`);

  const out = [];
  let missing = 0;
  for (const t of targets) {
    const fetched = await fetchLocality(t.mlab, yearArg);
    if (!fetched) {
      missing++;
      console.log(`  ✗ ${label(t)} → "${t.mlab}" : no M-Lab data`);
      continue;
    }
    const summary = summarizeLocality(fetched.rows, fetched.year);
    if (!summary) { missing++; console.log(`  ✗ ${label(t)} → "${t.mlab}" : empty`); continue; }
    if (summary.sample_count < MIN_SAMPLES) {
      missing++;
      console.log(`  ✗ ${label(t)} → "${t.mlab}" : only ${summary.sample_count} samples (<${MIN_SAMPLES}), skipped`);
      continue;
    }

    out.push({
      geo_level: t.geo_level,
      district: t.district,
      taluk: t.taluk,
      mlab_locality: t.mlab,
      match_type: t.match_type,
      ...summary,
    });
    console.log(
      `  ✓ ${label(t)} → "${t.mlab}" [${t.match_type}, ${fetched.year}]: ` +
      `${summary.download_mbps}↓/${summary.upload_mbps}↑ Mbps, ${summary.latency_ms}ms, n=${summary.sample_count}`,
    );
  }

  console.log(`\nResolved ${out.length}/${targets.length} (${missing} without data).`);

  if (dryRun) { console.log('Dry run — not writing to Supabase.'); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to write');

  await upsert(supabaseUrl, serviceKey, out);
  console.log(`Upserted ${out.length} rows into mlab_benchmarks.`);
}

const label = (t) => (t.geo_level === 'district' ? `[D] ${t.district}` : `[T] ${t.district}/${t.taluk}`);

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('ingest-mlab failed:', err.message); process.exit(1); });
}
