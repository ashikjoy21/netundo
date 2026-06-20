#!/usr/bin/env node
/**
 * ingest-mlab-tests.mjs — load M-Lab individual NDT tests (CC0) into test_results
 * tagged source='mlab', for display as labelled map points.
 *
 * Input: a JSON file exported from BigQuery (run scripts/sql/mlab-kerala-tests.sql,
 * then "Save results → JSON"). Each row: date, download_mbps, latency_ms, lat,
 * lng, city, isp_name, asn.
 *
 * These are INDEPENDENT measurements (single-stream NDT, IP-geolocated) — they are
 * tagged source='mlab' and EXCLUDED from netundo's aggregates (migration 009), so
 * they enrich the map + an independent-test count without skewing real numbers.
 *
 * Each test is mapped to a netundo district/taluk by point-in-polygon against
 * scripts/data/kerala-taluks.geojson (tests outside Kerala polygons are dropped).
 *
 * Usage:
 *   node scripts/ingest-mlab-tests.mjs <bigquery-export.json> [--dry-run] [--replace]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (omit for --dry-run).
 *   --replace  delete existing source='mlab' rows before inserting (idempotent reload)
 */

import fs from 'fs';

const GEOJSON = new URL('./data/kerala-taluks.geojson', import.meta.url);

// --- point-in-polygon (same approach as ingest-ookla) -----------------------
function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
function bboxOf(g) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const poly of ringsOf(g)) for (const [x, y] of poly[0]) {
    if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
  }
  return [a, b, c, d];
}
function pip(pt, g) {
  let inside = false;
  for (const poly of ringsOf(g)) {
    const r = poly[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function loadTaluks() {
  const gj = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
  return gj.features.map((f) => ({ district: f.properties.district, taluk: f.properties.taluk, geom: f.geometry, bbox: bboxOf(f.geometry) }));
}
function assign(lon, lat, taluks) {
  for (const t of taluks) {
    const [a, b, c, d] = t.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    if (pip([lon, lat], t.geom)) return t;
  }
  return null;
}

// --- parse the BigQuery JSON export (array OR newline-delimited) -------------
function parseExport(path) {
  const text = fs.readFileSync(path, 'utf8').trim();
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function toRow(r, taluks) {
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  const dl = Number(r.download_mbps);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(dl) || dl <= 0) return null;
  const place = assign(lng, lat, taluks);
  if (!place) return null;
  return {
    source: 'mlab',
    district: place.district,
    taluk: place.taluk,
    download_mbps: Number(dl.toFixed(2)),
    latency_ms: r.latency_ms != null ? Number(Number(r.latency_ms).toFixed(1)) : null,
    lat,
    lng,
    isp_name: r.isp_name || null,
    asn: r.asn != null ? Number(r.asn) : null,
    consent_public: true,
    is_outlier: false,
    created_at: r.date ? new Date(r.date).toISOString() : null,
  };
}

async function deleteExisting(url, key) {
  const res = await fetch(`${url}/rest/v1/test_results?source=eq.mlab`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`delete failed ${res.status}: ${await res.text()}`);
}

async function insertRows(url, key, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${url}/rest/v1/test_results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`insert failed ${res.status}: ${await res.text()}`);
    process.stdout.write(`\r  inserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Pass the BigQuery JSON export path');

  const taluks = loadTaluks();
  const raw = parseExport(file);
  console.log(`Parsed ${raw.length} M-Lab tests; mapping to taluks…`);

  const rows = [];
  let dropped = 0;
  const byDistrict = {};
  for (const r of raw) {
    const row = toRow(r, taluks);
    if (!row) { dropped++; continue; }
    rows.push(row);
    byDistrict[row.district] = (byDistrict[row.district] || 0) + 1;
  }
  console.log(`Mapped ${rows.length} into Kerala taluks (${dropped} dropped outside polygons).`);
  console.log('per district:', byDistrict);

  if (dryRun) { console.log('Dry run — not writing.'); return; }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to write');

  if (replace) { console.log('Deleting existing source=mlab rows…'); await deleteExisting(url, key); }
  await insertRows(url, key, rows);
  console.log(`Inserted ${rows.length} M-Lab tests (source='mlab') into test_results.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('ingest-mlab-tests failed:', err.message); process.exit(1); });
}
