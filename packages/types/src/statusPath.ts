// URLs for shareable outage status pages: /status/{district}/{taluk}/{brand}
// with ?kind=mobile when relevant. Shared by the web app (share buttons) and
// the Pages Function that renders the page with Open Graph tags.

import type { ConnectionKind } from './providers';

export function slugifyPlace(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Brand keys like "lco:sree-cable" become "lco.sree-cable" in a path segment. */
export function brandKeyToSegment(brandKey: string): string {
  return brandKey.replace(':', '.');
}

export function segmentToBrandKey(segment: string): string {
  return segment.replace('.', ':');
}

export function statusPath(district: string, taluk: string, brandKey: string, kind: ConnectionKind): string {
  const base = `/status/${slugifyPlace(district)}/${slugifyPlace(taluk)}/${brandKeyToSegment(brandKey)}`;
  return kind === 'mobile' ? `${base}?kind=mobile` : base;
}
