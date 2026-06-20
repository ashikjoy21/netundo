#!/usr/bin/env node
/**
 * ingest-ookla.mjs — pull Speedtest® by Ookla® Open Data tiles for Kerala and
 * upsert per-district / per-taluk aggregates into `ookla_benchmarks`.
 *
 * Ookla Open Data: 610m (zoom-16) tiles with avg download/upload/latency, tests
 * and devices, per quarter, fixed + mobile. Licensed CC BY-NC-SA 4.0 — usable
 * because netundo is a NON-COMMERCIAL project. Obligations honoured:
 *   * Attribution: "Speedtest® by Ookla®" + the source string stored per row.
 *   * Share-alike: this derived data is published under CC BY-NC-SA 4.0 and is
 *     kept in its OWN table (never blended into test_results/aggregate_*), so the
 *     viral SA term does not relicense netundo's own data.
 *
 * Tiles carry no place names, so each tile centroid (derived from its quadkey) is
 * mapped to a netundo taluk via point-in-polygon against scripts/data/kerala-
 * taluks.geojson (boundaries from geoBoundaries IND ADM3, CC BY 4.0). District
 * rows roll up the taluks within them.
 *
 * Usage:
 *   node scripts/ingest-ookla.mjs [--quarter 2025-Q3] [--dry-run]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (omit for --dry-run).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DuckDBInstance } from '@duckdb/node-api';

const GEOJSON = new URL('./data/kerala-taluks.geojson', import.meta.url);
const BBOX = { lon0: 74.7, lon1: 77.6, lat0: 8.0, lat1: 13.0 };
const Z = 8; // quadkey-prefix zoom for row-group pruning
const TYPES = ['fixed', 'mobile'];

// --- quadkey helpers --------------------------------------------------------

function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [x, y];
}
function quadkey(x, y, z) {
  let qk = '';
  for (let i = z; i > 0; i--) {
    let d = 0;
    const m = 1 << (i - 1);
    if (x & m) d++;
    if (y & m) d += 2;
    qk += d;
  }
  return qk;
}
/** Centre lon/lat of a z16 tile from its quadkey. */
function quadkeyToLonLat(qk) {
  let x = 0;
  let y = 0;
  const z = qk.length;
  for (let i = 0; i < z; i++) {
    const b = z - i - 1;
    const d = +qk[i];
    if (d & 1) x |= 1 << b;
    if (d & 2) y |= 1 << b;
  }
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return [lon, lat];
}

function keralaQuadkeyRanges() {
  const [x0, y0] = tileXY(BBOX.lon0, BBOX.lat1, Z);
  const [x1, y1] = tileXY(BBOX.lon1, BBOX.lat0, Z);
  const ranges = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      const p = quadkey(x, y, Z);
      ranges.push(`(quadkey BETWEEN '${p}${'0'.repeat(16 - Z)}' AND '${p}${'3'.repeat(16 - Z)}')`);
    }
  }
  return ranges.join(' OR ');
}

// --- point-in-polygon -------------------------------------------------------

function ringsOf(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}
function bboxOf(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of ringsOf(geom)) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}
function pip(pt, geom) {
  let inside = false;
  for (const poly of ringsOf(geom)) {
    const r = poly[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0];
      const yi = r[i][1];
      const xj = r[j][0];
      const yj = r[j][1];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function loadTaluks() {
  const gj = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
  return gj.features.map((f) => ({
    district: f.properties.district,
    taluk: f.properties.taluk,
    geom: f.geometry,
    bbox: bboxOf(f.geometry),
  }));
}

function assignTaluk(lon, lat, taluks) {
  for (const t of taluks) {
    const [minX, minY, maxX, maxY] = t.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (pip([lon, lat], t.geom)) return t;
  }
  return null;
}

// --- Ookla fetch ------------------------------------------------------------

function quarterUrl(type, year, q) {
  const mm = String((q - 1) * 3 + 1).padStart(2, '0');
  return `https://ookla-open-data.s3.amazonaws.com/parquet/performance/type=${type}/year=${year}/quarter=${q}/${year}-${mm}-01_performance_${type}_tiles.parquet`;
}

async function head(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20000) });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

/** Find the newest quarter present for `type` (probe back ~6 quarters). */
async function latestQuarter(type) {
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < 6; i++) {
    if (await head(quarterUrl(type, y, q))) return { year: y, q };
    q--;
    if (q < 1) { q = 4; y--; }
  }
  return null;
}

/** Download the parquet to a local cache (reused if already present). DuckDB's
 *  remote HTTP range reads of these 300MB+ files corrupt intermittently
 *  (Snappy decompression failures), so we fetch once and query locally. */
async function downloadParquet(url, dest, attempts = 4) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`  cached: ${path.basename(dest)} (${(fs.statSync(dest).size / 1048576).toFixed(0)} MB)`);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      console.log(`  downloaded ${path.basename(dest)} (${(fs.statSync(dest).size / 1048576).toFixed(0)} MB)`);
      return dest;
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(dest); } catch {}
      console.warn(`  download attempt ${i + 1} failed (${String(err.message).slice(0, 50)}); retrying…`);
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

const EXTRACT_SQL = (src, ranges) =>
  `SELECT quadkey, avg_d_kbps, avg_u_kbps, avg_lat_ms, tests, devices
   FROM read_parquet('${src}') WHERE ${ranges}`;

/**
 * Extract Kerala tiles. Prefer a REMOTE read (DuckDB fetches only the row groups
 * covering Kerala's quadkeys — ~tens of MB, not the whole 345MB file). These
 * range reads corrupt intermittently (Snappy failures), and the corruption is
 * connection-sticky, so we use a FRESH instance per attempt with high http
 * retries. Only if every remote attempt fails do we fall back to downloading the
 * whole file once and reading it locally.
 */
async function extractKeralaTiles(url, ranges, type, period, remoteAttempts = 4) {
  for (let i = 0; i < remoteAttempts; i++) {
    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    try {
      await conn.run('INSTALL httpfs; LOAD httpfs; SET http_retries=10; SET http_timeout=120000;');
      const r = await conn.runAndReadAll(EXTRACT_SQL(url, ranges));
      return r.getRowObjects();
    } catch (err) {
      console.warn(`  remote attempt ${i + 1} failed (${String(err.message).slice(0, 50)}); fresh retry…`);
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    } finally {
      conn.closeSync?.();
    }
  }

  // Fallback: download once, read locally.
  console.warn('  remote reads exhausted — falling back to full download…');
  const dest = path.join(os.tmpdir(), 'ookla-cache', `${type}-${period}.parquet`);
  await downloadParquet(url, dest);
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  const r = await conn.runAndReadAll(EXTRACT_SQL(dest, ranges));
  return r.getRowObjects();
}

// --- aggregation ------------------------------------------------------------

function aggregate(tiles, taluks, type, period) {
  // test-weighted accumulators keyed by district|taluk
  const byTaluk = new Map();
  let unassigned = 0;
  for (const t of tiles) {
    const tests = Number(t.tests) || 0;
    if (!tests) continue;
    const [lon, lat] = quadkeyToLonLat(t.quadkey);
    const place = assignTaluk(lon, lat, taluks);
    if (!place) { unassigned += tests; continue; }
    const key = `${place.district}|${place.taluk}`;
    const a = byTaluk.get(key) || { district: place.district, taluk: place.taluk, dl: 0, ul: 0, lat: 0, tests: 0, devices: 0, tiles: 0 };
    a.dl += Number(t.avg_d_kbps) * tests;
    a.ul += Number(t.avg_u_kbps) * tests;
    a.lat += Number(t.avg_lat_ms) * tests;
    a.tests += tests;
    a.devices += Number(t.devices) || 0;
    a.tiles += 1;
    byTaluk.set(key, a);
  }

  const rows = [];
  const districtAgg = new Map();
  for (const a of byTaluk.values()) {
    rows.push(mkRow('taluk', a.district, a.taluk, type, period, a));
    const d = districtAgg.get(a.district) || { district: a.district, taluk: null, dl: 0, ul: 0, lat: 0, tests: 0, devices: 0, tiles: 0 };
    d.dl += a.dl; d.ul += a.ul; d.lat += a.lat; d.tests += a.tests; d.devices += a.devices; d.tiles += a.tiles;
    districtAgg.set(a.district, d);
  }
  for (const d of districtAgg.values()) rows.push(mkRow('district', d.district, null, type, period, d));
  return { rows, unassigned, taluksHit: byTaluk.size };
}

function mkRow(geo_level, district, taluk, conn_type, period, a) {
  return {
    geo_level,
    district,
    taluk,
    conn_type,
    period,
    download_mbps: round(a.dl / a.tests / 1000),
    upload_mbps: round(a.ul / a.tests / 1000),
    latency_ms: round(a.lat / a.tests),
    tests: a.tests,
    devices: a.devices,
    tile_count: a.tiles,
  };
}
const round = (v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);

// --- Supabase upsert --------------------------------------------------------

async function upsert(supabaseUrl, serviceKey, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await fetch(`${supabaseUrl}/rest/v1/ookla_benchmarks`, {
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
  const quarterArg = args.includes('--quarter') ? args[args.indexOf('--quarter') + 1] : null;

  const taluks = loadTaluks();
  const ranges = keralaQuadkeyRanges();
  console.log(`Loaded ${taluks.length} taluk polygons; ${ranges.split(' OR ').length} Kerala quadkey ranges.`);

  const allRows = [];
  for (const type of TYPES) {
    let year;
    let q;
    if (quarterArg) {
      const m = quarterArg.match(/^(\d{4})-Q([1-4])$/);
      if (!m) throw new Error('--quarter must be YYYY-Qn');
      year = Number(m[1]); q = Number(m[2]);
      if (!(await head(quarterUrl(type, year, q)))) { console.log(`  ${type} ${quarterArg}: not available, skipping`); continue; }
    } else {
      const latest = await latestQuarter(type);
      if (!latest) { console.log(`  ${type}: no recent quarter found, skipping`); continue; }
      ({ year, q } = latest);
    }
    const period = `${year}-Q${q}`;
    const url = quarterUrl(type, year, q);
    console.log(`\n${type.toUpperCase()} ${period}: extracting Kerala tiles (remote)…`);
    const t0 = Date.now();
    const tiles = await extractKeralaTiles(url, ranges, type, period);
    console.log(`  ${tiles.length} tiles fetched (${((Date.now() - t0) / 1000).toFixed(0)}s); mapping to taluks…`);
    const { rows, unassigned, taluksHit } = aggregate(tiles, taluks, type, period);
    const totalTests = rows.filter((r) => r.geo_level === 'district').reduce((s, r) => s + r.tests, 0);
    console.log(`  → ${rows.length} rows (${taluksHit} taluks + districts), ${totalTests.toLocaleString()} tests mapped, ${unassigned.toLocaleString()} tests unassigned`);
    for (const r of rows.filter((x) => x.geo_level === 'district').sort((a, b) => b.download_mbps - a.download_mbps).slice(0, 5)) {
      console.log(`    ${r.district}: ${r.download_mbps}↓/${r.upload_mbps}↑ Mbps, ${r.latency_ms}ms (n=${r.tests})`);
    }
    allRows.push(...rows);
  }

  console.log(`\nTotal rows: ${allRows.length}`);
  if (dryRun) { console.log('Dry run — not writing to Supabase.'); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to write');
  await upsert(supabaseUrl, serviceKey, allRows);
  console.log(`Upserted ${allRows.length} rows into ookla_benchmarks.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('ingest-ookla failed:', err.message); process.exit(1); });
}
