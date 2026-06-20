import { KERALA_VILLAGES } from './keralaPlaces';

/**
 * URL slug helpers and reverse lookups for the locality pages.
 *
 * Place names in `keralaPlaces.ts` are the canonical display strings; slugs are
 * the kebab-cased forms used in URLs (e.g. "Sulthan Bathery" -> "sulthan-bathery").
 * Slugs are scoped by their parent (taluk slugs are unique within a district),
 * so lookups always take the parent slug into account.
 */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface DistrictParams {
  district: string;
}

export interface TalukParams {
  district: string;
  taluk: string;
}

export interface TalukLocation {
  district: string; // canonical display name
  taluk: string; // canonical display name
  districtSlug: string;
  talukSlug: string;
  villages: string[];
}

export interface DistrictLocation {
  district: string;
  districtSlug: string;
  taluks: string[];
}

/** All district route params, for generateStaticParams. */
export function allDistrictParams(): DistrictParams[] {
  return Object.keys(KERALA_VILLAGES).map((district) => ({
    district: slugify(district),
  }));
}

/** All district/taluk route params, for generateStaticParams. */
export function allTalukParams(): TalukParams[] {
  const params: TalukParams[] = [];
  for (const [district, taluks] of Object.entries(KERALA_VILLAGES)) {
    for (const taluk of Object.keys(taluks)) {
      params.push({ district: slugify(district), taluk: slugify(taluk) });
    }
  }
  return params;
}

/** Resolve a district slug back to its canonical name + taluk list. */
export function findDistrict(districtSlug: string): DistrictLocation | null {
  for (const [district, taluks] of Object.entries(KERALA_VILLAGES)) {
    if (slugify(district) === districtSlug) {
      return { district, districtSlug, taluks: Object.keys(taluks) };
    }
  }
  return null;
}

/** Resolve a district/taluk slug pair back to canonical names + village list. */
export function findTaluk(districtSlug: string, talukSlug: string): TalukLocation | null {
  const districtMatch = findDistrict(districtSlug);
  if (!districtMatch) return null;

  const taluks = KERALA_VILLAGES[districtMatch.district];
  for (const taluk of Object.keys(taluks)) {
    if (slugify(taluk) === talukSlug) {
      return {
        district: districtMatch.district,
        taluk,
        districtSlug,
        talukSlug,
        villages: taluks[taluk],
      };
    }
  }
  return null;
}

/** Other taluks in the same district (for "nearby areas" links). */
export function siblingTaluks(districtSlug: string, talukSlug: string): Array<{ name: string; slug: string }> {
  const districtMatch = findDistrict(districtSlug);
  if (!districtMatch) return [];
  return districtMatch.taluks
    .filter((taluk) => slugify(taluk) !== talukSlug)
    .map((taluk) => ({ name: taluk, slug: slugify(taluk) }));
}
