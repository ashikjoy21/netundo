import { describe, expect, it } from 'vitest';
import { cleanOrgName, normalizeOperatorName, resolveProvider, BRANDS, EXCLUDED_ASNS } from './providers';

const r = (asn: number | null, connectionType: string, extra: Partial<Parameters<typeof resolveProvider>[0]> = {}) =>
  resolveProvider({ asn, ispOrg: null, connectionType, ...extra });

describe('resolveProvider — ASN only', () => {
  it.each([
    [55836, 'mobile', 'jio', 'mobile'],
    [55836, 'wifi', 'jio', 'broadband'],
    [45609, 'mobile', 'airtel', 'mobile'],
    [24560, 'wifi', 'airtel', 'broadband'],
    [9829, 'wifi', 'bsnl', 'broadband'],
    [9829, 'wired', 'bsnl', 'broadband'],
    [17465, 'wifi', 'asianet', 'broadband'],
    [38266, 'mobile', 'vi', 'mobile'],
    [45271, 'mobile', 'vi', 'mobile'],
    [9583, 'wifi', 'sify', 'broadband'],
    [24186, 'wifi', 'railwire', 'broadband'],
    [141549, 'wifi', 'railwire', 'broadband'],
    [24309, 'wifi', 'act', 'broadband'],
    [135217, 'wifi', 'peak-air', 'broadband'],
    [138754, 'wifi', 'kerala-vision', 'broadband'],
  ])('AS%i on %s → %s/%s', (asn, ct, brand, kind) => {
    const out = r(asn, ct);
    expect(out.brandKey).toBe(brand);
    expect(out.kind).toBe(kind);
    expect(out.excluded).toBe(false);
  });

  it('groups both Airtel ASNs under one brand', () => {
    expect(r(45609, 'mobile').displayName).toBe(r(24560, 'wifi').displayName);
  });

  it('treats Wi-Fi on a mobile-only AS as mobile (hotspot)', () => {
    expect(r(45609, 'wifi').kind).toBe('mobile');
    expect(r(38266, 'wifi').kind).toBe('mobile');
  });

  it('excludes VPN / hosting / foreign ASNs', () => {
    for (const asn of [13335, 36183, 31898, 49981, 60068, 50010]) {
      expect(r(asn, 'wifi').excluded).toBe(true);
    }
  });

  it('falls back to a cleaned org name for unmapped ASNs', () => {
    const out = r(133301, 'wifi', { ispOrg: 'INHOME ENTERTAINMENTS PRIVATE LIMITED' });
    expect(out.brandKey).toBe('asn:133301');
    expect(out.displayName).toBe('Inhome Entertainments');
  });
});

describe('resolveProvider — self-reported', () => {
  it('lets an LCO behind Sify show up as its own entry', () => {
    const out = r(9583, 'wifi', { reported: 'lco', reportedName: 'Sree Cable Network Pvt Ltd' });
    expect(out.brandKey).toBe('lco:sree-cable-network');
    expect(out.displayName).toBe('Sree Cable Network Pvt Ltd');
    expect(out.kind).toBe('broadband');
    expect(out.selfReported).toBe(true);
    expect(out.asnBrand).toBe('sify');
  });

  it('groups LCO name variants together', () => {
    const a = r(24186, 'wifi', { reported: 'lco', reportedName: 'Sree cable network' });
    const b = r(9583, 'wifi', { reported: 'lco', reportedName: 'SREE CABLE NETWORK PVT. LTD.' });
    expect(a.brandKey).toBe(b.brandKey);
  });

  it('trusts a self-report for brands without known ASNs (KFON)', () => {
    const out = r(9829, 'wifi', { reported: 'kfon' });
    expect(out.brandKey).toBe('kfon');
    expect(out.mismatch).toBe(false);
  });

  it('accepts an LCO answer from the Kerala Vision AS (KCCL member operators)', () => {
    const out = r(138754, 'wifi', { ispOrg: 'Tirur Cable Vision Pvt Ltd', reported: 'lco', reportedName: 'Tirur Cable Vision' });
    expect(out.brandKey).toBe('lco:tirur-cable-vision');
    expect(out.mismatch).toBe(false);
  });

  it('accepts a Kerala Vision answer from another LCO upstream', () => {
    expect(r(9583, 'wifi', { reported: 'kerala-vision' }).brandKey).toBe('kerala-vision');
  });

  it('overrides a self-report that contradicts the ASN', () => {
    const out = r(55836, 'mobile', { reported: 'bsnl' });
    expect(out.brandKey).toBe('jio');
    expect(out.mismatch).toBe(true);
  });

  it('rejects an LCO answer from a mobile-only AS', () => {
    const out = r(45609, 'mobile', { reported: 'lco', reportedName: 'Anything' });
    expect(out.brandKey).toBe('airtel');
    expect(out.mismatch).toBe(true);
  });

  it('ignores unnamed LCO/Other answers', () => {
    expect(r(9583, 'wifi', { reported: 'lco', reportedName: '  ' }).brandKey).toBe('sify');
    expect(r(9583, 'wifi', { reported: 'other' }).brandKey).toBe('sify');
  });

  it('ignores unknown slugs', () => {
    expect(r(9829, 'wifi', { reported: 'nonsense' }).brandKey).toBe('bsnl');
  });
});

describe('data file sanity', () => {
  it('maps every ASN to exactly one brand', () => {
    const seen = new Set<number>();
    for (const b of BRANDS) for (const a of b.asns) {
      expect(seen.has(a.asn)).toBe(false);
      expect(a.asn in EXCLUDED_ASNS).toBe(false);
      seen.add(a.asn);
    }
  });

  it('has unique slugs', () => {
    expect(new Set(BRANDS.map((b) => b.slug)).size).toBe(BRANDS.length);
  });
});

describe('name helpers', () => {
  it('cleans raw ASN org strings', () => {
    expect(cleanOrgName('Airtel UNOC, CP-05, Sector 8, IMT Manesar, Gurugram, Haryana 122051')).toBe('Airtel UNOC');
    expect(cleanOrgName('Intraworld Entertainments Private Limited')).toBe('Intraworld Entertainments');
    expect(cleanOrgName(null)).toBeNull();
  });
  it('normalises operator names', () => {
    expect(normalizeOperatorName('  The Sree Cable Co. ')).toBe('sree-cable');
  });
});
