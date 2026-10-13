import { describe, expect, it } from 'vitest';
import { outageHeadline } from '@netundo/types';
import { brandKeyForAnswer, buildStatus, countReporters, validateReport, type EventRow, type ReportRow } from './outages';

const now = new Date('2026-10-13T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const report = (over: Partial<ReportRow>): ReportRow => ({
  district: 'Ernakulam',
  taluk: 'Kanayannor',
  village: 'Kakkanad',
  brand_key: 'kerala-vision',
  provider_name: 'Kerala Vision',
  kind: 'broadband',
  status: 'down',
  comment: null,
  last_seen_at: ago(5),
  ip_hash: 'ip1',
  client_token_hash: 't1',
  ...over,
});

describe('countReporters', () => {
  it('counts distinct tokens', () => {
    expect(countReporters([{ ip_hash: 'a', client_token_hash: '1' }, { ip_hash: 'b', client_token_hash: '2' }])).toBe(2);
  });
  it('caps one IP at two reporters (one person clearing storage)', () => {
    const rows = ['1', '2', '3', '4'].map((t) => ({ ip_hash: 'same', client_token_hash: t }));
    expect(countReporters(rows)).toBe(2);
  });
  it('lets CGNAT neighbours plus other IPs reach the threshold', () => {
    expect(
      countReporters([
        { ip_hash: 'cgnat', client_token_hash: '1' },
        { ip_hash: 'cgnat', client_token_hash: '2' },
        { ip_hash: 'other', client_token_hash: '3' },
      ]),
    ).toBe(3);
  });
});

describe('buildStatus', () => {
  const event: EventRow = {
    id: 'e1',
    district: 'Ernakulam',
    taluk: 'Kanayannor',
    brand_key: 'kerala-vision',
    provider_name: 'Kerala Vision',
    kind: 'broadband',
    started_at: ago(20),
    last_report_at: ago(2),
    report_count: 3,
    peak_reporters: 3,
    top_village: 'Kakkanad',
  };

  it('groups by taluk + provider + kind and flags live outages', () => {
    const { groups } = buildStatus(
      [
        report({ client_token_hash: 't1', ip_hash: 'a' }),
        report({ client_token_hash: 't2', ip_hash: 'b', status: 'slow' }),
        report({ client_token_hash: 't3', ip_hash: 'c', village: 'Edappally' }),
        report({ brand_key: 'jio', provider_name: 'Jio', kind: 'mobile', client_token_hash: 't4' }),
      ],
      [event],
      { now, outageWindowMin: 30 },
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ brand_key: 'kerala-vision', reporters: 3, likely_outage: true, status: 'down', top_village: 'Kakkanad' });
    expect(groups[1]).toMatchObject({ brand_key: 'jio', kind: 'mobile', likely_outage: false });
  });

  it('never shows a stale event as live, even if the cron has not closed it', () => {
    const { groups } = buildStatus([report({ last_seen_at: ago(45) })], [{ ...event, last_report_at: ago(45) }], {
      now,
      outageWindowMin: 30,
    });
    expect(groups[0].likely_outage).toBe(false);
    expect(groups[0].recent_reporters).toBe(0);
    expect(groups[0].reporters).toBe(1);
  });

  it('returns the latest comments', () => {
    const { comments } = buildStatus([report({ comment: 'no net since 7pm' })], [], { now, outageWindowMin: 30 });
    expect(comments[0]).toMatchObject({ text: 'no net since 7pm', provider: 'Kerala Vision' });
  });
});

describe('validateReport', () => {
  const base = {
    district: 'Ernakulam',
    taluk: 'Kanayannor',
    village: 'Kakkanad',
    provider: { reported: 'kerala-vision' },
    kind: 'broadband',
    status: 'down',
    clientToken: 'abcdefghijklmnop1234',
  };
  it('accepts a valid report', () => {
    expect(validateReport(base)).toMatchObject({ ok: true, report: { brandKey: 'kerala-vision', village: 'Kakkanad' } });
  });
  it('rejects a taluk from another district', () => {
    expect(validateReport({ ...base, taluk: 'Kozhikode' })).toMatchObject({ ok: false, field: 'taluk' });
  });
  it('requires a name for local cable operators', () => {
    expect(validateReport({ ...base, provider: { reported: 'lco' } })).toMatchObject({ ok: false, field: 'provider' });
    expect(validateReport({ ...base, provider: { reported: 'lco', name: 'Sree Cable' } })).toMatchObject({
      ok: true,
      report: { brandKey: 'lco:sree-cable', providerName: 'Sree Cable' },
    });
  });
  it('rejects abusive comments', () => {
    expect(validateReport({ ...base, comment: 'useless shit' })).toMatchObject({ ok: false, field: 'comment' });
  });
  it('rejects bad status and kind', () => {
    expect(validateReport({ ...base, status: 'meh' })).toMatchObject({ ok: false, field: 'status' });
    expect(validateReport({ ...base, kind: 'wifi' })).toMatchObject({ ok: false, field: 'kind' });
  });
});

describe('brandKeyForAnswer / headline', () => {
  it('builds keys', () => {
    expect(brandKeyForAnswer('jio', '')).toEqual({ brandKey: 'jio', providerName: 'Jio' });
    expect(brandKeyForAnswer('nope', '')).toBeNull();
  });
  it('writes the share headline', () => {
    expect(outageHeadline({ reporters: 5, provider: 'Kerala Vision', place: 'Kakkanad', status: 'down', windowMin: 30 })).toBe(
      '5 people reported Kerala Vision down in Kakkanad in the last 30 min',
    );
  });
});
