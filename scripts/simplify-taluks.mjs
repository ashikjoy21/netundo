#!/usr/bin/env node
/**
 * Build the compact taluk-boundary file bundled into the API worker for
 * GET /v1/locate (point → district/taluk). Re-run when kerala-taluks.geojson
 * changes:
 *
 *   node scripts/simplify-taluks.mjs
 *
 * Douglas–Peucker simplification at ~150 m tolerance, coordinates rounded to
 * 4 dp (~11 m). Output: workers/api/src/data/kerala-taluks.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'scripts/data/kerala-taluks.geojson'), 'utf8'));
const TOLERANCE = 0.0015; // degrees, ~150 m at Kerala's latitude

function perpDist([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > TOLERANCE && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : points;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
let pointsIn = 0;
let pointsOut = 0;

const taluks = src.features.map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const outPolys = polys.map((rings) =>
    rings.map((ring) => {
      pointsIn += ring.length;
      const simple = simplify(ring).map(([x, y]) => [r4(x), r4(y)]);
      pointsOut += simple.length;
      for (const [x, y] of simple) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return simple;
    }),
  );
  return { d: f.properties.district, t: f.properties.taluk, b: [minX, minY, maxX, maxY], p: outPolys };
});

const out = join(root, 'workers/api/src/data/kerala-taluks.json');
const json = JSON.stringify(taluks);
writeFileSync(out, json);
console.log(`${taluks.length} taluks, ${pointsIn} → ${pointsOut} points, ${(json.length / 1024).toFixed(0)} KB → ${out}`);
