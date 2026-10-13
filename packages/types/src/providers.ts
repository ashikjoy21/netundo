// ASN → brand mapping and provider resolution, shared by the API worker (which
// groups rankings by brand) and the web app (provider pickers, labels).
//
// To add or fix a brand, edit BRANDS below and open a PR. Mapping is applied at
// read time, so a change here re-labels old tests too — no backfill needed.

export type ConnectionKind = 'broadband' | 'mobile';

export interface BrandAsn {
  asn: number;
  /** Set when this ASN only ever carries one kind of traffic (e.g. a mobile-only
   *  AS). A phone on a mobile hotspot reports "wifi", but its traffic still exits
   *  through the mobile AS — so `kind: 'mobile'` overrides the browser's label. */
  kind?: ConnectionKind;
  note?: string;
}

export interface Brand {
  slug: string;
  name: string;
  /** Malayalam display name, where commonly used. */
  nameMl?: string;
  kinds: ConnectionKind[];
  asns: BrandAsn[];
  /** Shown in the "Who's your provider?" picker. */
  inPicker: boolean;
  /** Carries traffic for local cable operators, so an LCO user exiting through
   *  this ASN is expected rather than a mismatch. */
  upstream?: boolean;
}

export const BRANDS: Brand[] = [
  {
    slug: 'jio',
    name: 'Jio',
    nameMl: 'ജിയോ',
    kinds: ['mobile', 'broadband'],
    // JioFiber and Jio mobile share AS55836, so kind comes from the connection.
    asns: [{ asn: 55836 }],
    inPicker: true,
  },
  {
    slug: 'airtel',
    name: 'Airtel',
    nameMl: 'എയർടെൽ',
    kinds: ['mobile', 'broadband'],
    asns: [
      { asn: 45609, kind: 'mobile', note: 'Airtel mobile (GPRS/4G/5G)' },
      { asn: 24560, kind: 'broadband', note: 'Airtel Xstream Fiber' },
      { asn: 9498, note: 'Airtel backbone' },
    ],
    inPicker: true,
  },
  {
    slug: 'bsnl',
    name: 'BSNL',
    nameMl: 'ബി.എസ്.എൻ.എൽ',
    kinds: ['broadband', 'mobile'],
    // AS9829 carries both BSNL FTTH and BSNL mobile data.
    asns: [{ asn: 9829 }],
    inPicker: true,
  },
  {
    slug: 'vi',
    name: 'Vi',
    kinds: ['mobile'],
    asns: [
      { asn: 38266, kind: 'mobile', note: 'Vodafone Idea' },
      { asn: 45271, kind: 'mobile', note: 'Idea Cellular ("GPRS Delhi Mobile Subscriber IP")' },
      { asn: 55410, kind: 'mobile', note: 'Vodafone India' },
    ],
    inPicker: true,
  },
  {
    slug: 'kerala-vision',
    name: 'Kerala Vision',
    nameMl: 'കേരള വിഷൻ',
    kinds: ['broadband'],
    // TODO: confirm Kerala Vision's ASN(s). Until then, Kerala Vision appears
    // only through self-reported provider answers.
    asns: [],
    inPicker: true,
  },
  {
    slug: 'asianet',
    name: 'Asianet Broadband',
    nameMl: 'ഏഷ്യാനെറ്റ്',
    kinds: ['broadband'],
    asns: [{ asn: 17465, kind: 'broadband' }],
    inPicker: true,
  },
  {
    slug: 'kfon',
    name: 'KFON',
    nameMl: 'കെ-ഫോൺ',
    kinds: ['broadband'],
    asns: [],
    inPicker: true,
  },
  {
    slug: 'act',
    name: 'ACT Fibernet',
    kinds: ['broadband'],
    asns: [{ asn: 24309, kind: 'broadband', note: 'Atria Convergence (formerly Beam Telecom)' }],
    inPicker: true,
  },
  {
    slug: 'railwire',
    name: 'Railwire',
    kinds: ['broadband'],
    asns: [
      { asn: 141549, kind: 'broadband', note: 'Railwire ICT' },
      { asn: 24186, kind: 'broadband', note: 'RailTel (Railwire retail + LCO upstream)' },
    ],
    inPicker: true,
    upstream: true,
  },
  {
    slug: 'sify',
    name: 'Sify',
    kinds: ['broadband'],
    asns: [{ asn: 9583, kind: 'broadband' }],
    inPicker: true,
    upstream: true,
  },
  {
    slug: 'peak-air',
    name: 'Peak Air',
    kinds: ['broadband'],
    asns: [{ asn: 135217, kind: 'broadband' }],
    inPicker: false,
  },
  {
    slug: 'alliance',
    name: 'Alliance Broadband',
    kinds: ['broadband'],
    asns: [{ asn: 23860, kind: 'broadband' }],
    inPicker: false,
  },
  {
    slug: 'kelnet',
    name: 'Kelnet',
    kinds: ['broadband'],
    asns: [{ asn: 131262, kind: 'broadband' }],
    inPicker: false,
  },
  {
    slug: 'tata',
    name: 'Tata Communications',
    kinds: ['broadband'],
    asns: [{ asn: 4755, kind: 'broadband' }],
    inPicker: false,
    upstream: true,
  },
];

/** Networks whose results say nothing about a local ISP: VPNs, privacy relays,
 *  cloud/hosting ranges and foreign carriers. Excluded from rankings. */
export const EXCLUDED_ASNS: Record<number, string> = {
  13335: 'Cloudflare (WARP / 1.1.1.1 VPN)',
  36183: 'Akamai (iCloud Private Relay)',
  31898: 'Oracle Cloud',
  16509: 'Amazon AWS',
  14618: 'Amazon AWS',
  15169: 'Google',
  396982: 'Google Cloud',
  8075: 'Microsoft',
  14061: 'DigitalOcean',
  16276: 'OVH',
  24940: 'Hetzner',
  20473: 'Vultr',
  9009: 'M247 (VPN hosting)',
  60068: 'Datacamp / CDN77 (VPN hosting)',
  212238: 'Datacamp (VPN hosting)',
  49981: 'WorldStream (hosting)',
  50010: 'Omantel (foreign carrier)',
};

/** Picker options, in display order: picker brands, then LCO, then Other. */
export const LCO_SLUG = 'lco';
export const OTHER_SLUG = 'other';
export const PICKER_BRANDS: Brand[] = BRANDS.filter((b) => b.inPicker);

const BRAND_BY_SLUG = new Map(BRANDS.map((b) => [b.slug, b]));
const ASN_INDEX = new Map<number, { brand: Brand; entry: BrandAsn }>();
for (const brand of BRANDS) {
  for (const entry of brand.asns) ASN_INDEX.set(entry.asn, { brand, entry });
}

export function brandBySlug(slug: string): Brand | undefined {
  return BRAND_BY_SLUG.get(slug);
}

export function isKnownProviderSlug(slug: string): boolean {
  return BRAND_BY_SLUG.has(slug) || slug === LCO_SLUG || slug === OTHER_SLUG;
}

/** Normalise a free-text operator name into a stable key fragment, so
 *  "Sree Cable Network Pvt. Ltd" and "sree cable network" group together. */
export function normalizeOperatorName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\b(pvt|private|ltd|limited|llp|the|co|company)\b\.?/g, ' ')
    .replace(/[^a-z0-9ഀ-ൿ]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Turn a raw ASN org string ("Airtel UNOC, CP-05, Sector 8, …") into something
 *  readable for unmapped networks. */
export function cleanOrgName(org: string | null | undefined): string | null {
  if (!org) return null;
  let s = org.split(',')[0].trim();
  s = s.replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|b\.v\.|llc|s\.a\.o\.c)\b/gi, '').trim();
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s.-]+$/, '');
  if (!s) return null;
  // ALL-CAPS names ("VBC VISION") read better title-cased.
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

export interface ProviderInput {
  asn: number | null;
  ispOrg: string | null;
  /** Browser-level connection type from the test. */
  connectionType: string;
  /** Self-reported brand slug, `lco` or `other`. */
  reported?: string | null;
  /** Free-text name for `lco` / `other`. */
  reportedName?: string | null;
}

export interface ResolvedProvider {
  /** Stable grouping key: brand slug, `lco:<name>`, `other:<name>` or `asn:<n>`. */
  brandKey: string;
  displayName: string;
  kind: ConnectionKind;
  /** Brand implied by the ASN alone, if known. */
  asnBrand: string | null;
  /** True when the self-report was overridden because it contradicts the ASN. */
  mismatch: boolean;
  /** True when the answer came from the user rather than the ASN. */
  selfReported: boolean;
  /** VPN / hosting / foreign network: keep out of rankings. */
  excluded: boolean;
}

/** Decide which brand and connection kind a test (or report) belongs to.
 *
 * Self-reported brand wins, because many Kerala LCO customers exit through an
 * upstream like Sify or RailTel and the ASN alone would mislabel them. It is
 * overridden only when it plainly contradicts a known, non-upstream ASN brand
 * (e.g. "BSNL" reported from a Jio mobile IP). */
export function resolveProvider(input: ProviderInput): ResolvedProvider {
  const hit = input.asn != null ? ASN_INDEX.get(input.asn) : undefined;
  const asnBrand = hit?.brand ?? null;
  const excluded = input.asn != null && input.asn in EXCLUDED_ASNS;

  // Kind: the ASN wins when it only carries one kind of traffic (hotspot case);
  // otherwise trust the browser's mobile vs Wi-Fi/wired signal.
  const browserKind: ConnectionKind = input.connectionType === 'mobile' ? 'mobile' : 'broadband';
  const kind: ConnectionKind = hit?.entry.kind ?? browserKind;

  const asnResult = (mismatch: boolean): ResolvedProvider => {
    if (asnBrand) {
      return { brandKey: asnBrand.slug, displayName: asnBrand.name, kind, asnBrand: asnBrand.slug, mismatch, selfReported: false, excluded };
    }
    const name = cleanOrgName(input.ispOrg) ?? (input.asn != null ? `AS${input.asn}` : 'Unknown network');
    return {
      brandKey: input.asn != null ? `asn:${input.asn}` : 'unknown',
      displayName: name,
      kind,
      asnBrand: null,
      mismatch,
      selfReported: false,
      excluded,
    };
  };

  const reported = input.reported?.trim().toLowerCase() || null;
  if (!reported) return asnResult(false);

  const reportedName = input.reportedName?.trim().slice(0, 60) || null;

  if (reported === LCO_SLUG || reported === OTHER_SLUG) {
    // An LCO answer from a mobile-only AS is a wrong answer, not an LCO.
    if (reported === LCO_SLUG && hit?.entry.kind === 'mobile') return asnResult(true);
    const key = reportedName ? normalizeOperatorName(reportedName) : '';
    if (!key) {
      // "Other"/"LCO" with no name tells us nothing beyond the ASN.
      return asnResult(false);
    }
    return {
      brandKey: `${reported}:${key}`,
      displayName: reportedName as string,
      kind: reported === LCO_SLUG ? 'broadband' : kind,
      asnBrand: asnBrand?.slug ?? null,
      mismatch: false,
      selfReported: true,
      excluded,
    };
  }

  const brand = BRAND_BY_SLUG.get(reported);
  if (!brand) return asnResult(false);

  const contradicts =
    asnBrand != null &&
    asnBrand.slug !== brand.slug &&
    !asnBrand.upstream &&
    brand.asns.length > 0;
  if (contradicts) return asnResult(true);

  return {
    brandKey: brand.slug,
    displayName: brand.name,
    kind: brand.kinds.length === 1 ? brand.kinds[0] : kind,
    asnBrand: asnBrand?.slug ?? null,
    mismatch: false,
    selfReported: true,
    excluded,
  };
}

/** Display name for a brand key without a test row (outage reports, comments). */
export function displayNameForKey(brandKey: string, fallbackName?: string | null): string {
  const brand = BRAND_BY_SLUG.get(brandKey);
  if (brand) return brand.name;
  if (fallbackName) return fallbackName;
  const [, rest] = brandKey.split(':');
  return rest ? rest.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()) : brandKey;
}
