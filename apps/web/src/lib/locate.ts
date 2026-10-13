import { API_BASE } from './api';

export interface LocatedArea {
  district: string;
  taluk: string;
}

/** Ask the API which district/taluk a point is in. Coordinates are rounded to
 *  2 dp (~1 km) before they leave the browser and are never stored. */
export async function locateArea(lat: number, lng: number): Promise<LocatedArea | null> {
  if (!API_BASE) return null;
  const round2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  try {
    const res = await fetch(`${API_BASE}/v1/locate?lat=${round2(lat)}&lng=${round2(lng)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { district: string | null; taluk: string | null };
    return body.district && body.taluk ? { district: body.district, taluk: body.taluk } : null;
  } catch {
    return null;
  }
}
