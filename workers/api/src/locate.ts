/**
 * Point → Kerala district/taluk lookup for GET /v1/locate.
 *
 * Uses simplified taluk boundaries bundled with the worker
 * (src/data/kerala-taluks.json, built by scripts/simplify-taluks.mjs). The
 * caller's coordinates are only used for this lookup; nothing is stored.
 */

import TALUKS from './data/kerala-taluks.json';

type Ring = number[][];
interface TalukShape {
  d: string;
  t: string;
  b: [number, number, number, number];
  p: Ring[][];
}

const SHAPES = TALUKS as unknown as TalukShape[];

/** Points this close (degrees, ~3 km) outside a boundary still match it, which
 *  covers beaches, backwaters and simplification error along the coast. */
const NEAR_DEG = 0.03;

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inShape(x: number, y: number, shape: TalukShape): boolean {
  return shape.p.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)));
}

function segDist(x: number, y: number, [x1, y1]: number[], [x2, y2]: number[]): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function distToShape(x: number, y: number, shape: TalukShape): number {
  let best = Infinity;
  for (const poly of shape.p) {
    const outer = poly[0];
    for (let i = 1; i < outer.length; i++) best = Math.min(best, segDist(x, y, outer[i - 1], outer[i]));
  }
  return best;
}

export interface LocatedArea {
  district: string;
  taluk: string;
}

export function locateTaluk(lat: number, lng: number): LocatedArea | null {
  const x = lng;
  const y = lat;
  const near = SHAPES.filter(
    (s) => x >= s.b[0] - NEAR_DEG && x <= s.b[2] + NEAR_DEG && y >= s.b[1] - NEAR_DEG && y <= s.b[3] + NEAR_DEG,
  );

  const hit = near.find((s) => x >= s.b[0] && x <= s.b[2] && y >= s.b[1] && y <= s.b[3] && inShape(x, y, s));
  if (hit) return { district: hit.d, taluk: hit.t };

  let best: TalukShape | null = null;
  let bestDist = NEAR_DEG;
  for (const s of near) {
    const d = distToShape(x, y, s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best ? { district: best.d, taluk: best.t } : null;
}
