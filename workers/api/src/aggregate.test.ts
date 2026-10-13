import { describe, expect, it } from 'vitest';
import { aggregateByBrand, type BrandTestRow } from './aggregate';

const row = (over: Partial<BrandTestRow>): BrandTestRow => ({
  district: 'Ernakulam',
  taluk: 'Kanayannor',
  village: null,
  isp_name: null,
  asn: null,
  connection_type: 'wifi',
  download_mbps: 50,
  upload_mbps: 20,
  latency_ms: 10,
  jitter_ms: 2,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('aggregateByBrand', () => {
  it('merges multiple Airtel ASNs and splits broadband from mobile', () => {
    const out = aggregateByBrand([
      row({ asn: 24560, isp_name: 'Airtel UNOC, CP-05, Sector 8' }),
      row({ asn: 24560, isp_name: 'Airtel UNOC, CP-05, Sector 8' }),
      row({ asn: 45609, connection_type: 'mobile', isp_name: 'Bharti Airtel Limited' }),
      row({ asn: 45609, connection_type: 'wifi', isp_name: 'Bharti Airtel Limited' }), // hotspot
    ]);
    const bb = out.find((r) => r.brand_key === 'airtel' && r.kind === 'broadband');
    const mob = out.find((r) => r.brand_key === 'airtel' && r.kind === 'mobile');
    expect(bb?.sample_count).toBe(2);
    expect(bb?.isp_name).toBe('Airtel');
    expect(mob?.sample_count).toBe(2);
    expect(mob?.asns).toEqual([45609]);
  });

  it('drops VPN / hosting networks', () => {
    const out = aggregateByBrand([row({ asn: 13335 }), row({ asn: 9829 })]);
    expect(out.map((r) => r.brand_key)).toEqual(['bsnl']);
  });

  it('gives LCOs their own entry and records the self-reported share', () => {
    const out = aggregateByBrand([
      row({ asn: 9583, provider_reported: 'lco', provider_reported_name: 'Sree Cable' }),
      row({ asn: 9583 }),
    ]);
    const lco = out.find((r) => r.brand_key === 'lco:sree-cable');
    expect(lco?.isp_name).toBe('Sree Cable');
    expect(lco?.self_reported_share).toBe(1);
    expect(out.find((r) => r.brand_key === 'sify')?.self_reported_share).toBe(0);
  });

  it('buckets by place when grouping by taluk or village', () => {
    const rows = [
      row({ asn: 9829, taluk: 'Kanayannor', village: 'Kakkanad' }),
      row({ asn: 9829, taluk: 'Kanayannor', village: 'Edappally' }),
      row({ asn: 9829, taluk: 'Aluva' }),
    ];
    expect(aggregateByBrand(rows, 'district')).toHaveLength(1);
    expect(aggregateByBrand(rows, 'taluk')).toHaveLength(2);
    expect(aggregateByBrand(rows, 'village')).toHaveLength(3);
  });

  it('applies brand and kind filters after resolution', () => {
    const rows = [row({ asn: 55836, connection_type: 'mobile' }), row({ asn: 55836 })];
    expect(aggregateByBrand(rows, 'district', { kind: 'mobile' })).toHaveLength(1);
    expect(aggregateByBrand(rows, 'district', { brand: 'bsnl' })).toHaveLength(0);
  });

  it('computes medians', () => {
    const out = aggregateByBrand([
      row({ asn: 9829, download_mbps: 10 }),
      row({ asn: 9829, download_mbps: 30 }),
      row({ asn: 9829, download_mbps: 20 }),
    ]);
    expect(out[0].p50_download_mbps).toBe(20);
  });
});
