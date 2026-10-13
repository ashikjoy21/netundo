import { describe, expect, it } from 'vitest';
import { isVisibleUpdate, parseBearer, validateCreate, validatePatch, type OperatorRow } from './operator';

const op: OperatorRow = { id: 'o1', name: 'Kerala Vision NOC', brand_key: 'kerala-vision', allowed_districts: ['Ernakulam'], active: true };
const valid = {
  status: 'investigating',
  message: 'Fibre cut near Kakkanad, team on the way',
  eta: '2026-10-13T15:30:00+05:30',
  areas: [{ district: 'Ernakulam', taluk: 'Kanayannor' }],
};

describe('validateCreate', () => {
  it('accepts a valid update and normalises eta to UTC', () => {
    const r = validateCreate(valid, op);
    expect(r).toMatchObject({ ok: true, fields: { status: 'investigating', eta: '2026-10-13T10:00:00.000Z' } });
  });
  it('requires status, message and areas', () => {
    expect(validateCreate({ ...valid, status: 'done' }, op)).toMatchObject({ ok: false, field: 'status' });
    expect(validateCreate({ ...valid, message: '' }, op)).toMatchObject({ ok: false, field: 'message' });
    expect(validateCreate({ ...valid, areas: [] }, op)).toMatchObject({ ok: false, field: 'areas' });
  });
  it('enforces the token district scope and valid taluks', () => {
    expect(validateCreate({ ...valid, areas: [{ district: 'Kollam' }] }, op)).toMatchObject({ ok: false, field: 'areas[0].district' });
    expect(validateCreate({ ...valid, areas: [{ district: 'Ernakulam', taluk: 'Kozhikode' }] }, op)).toMatchObject({ ok: false, field: 'areas[0].taluk' });
    expect(validateCreate({ ...valid, areas: [{ district: 'Kollam' }] }, { ...op, allowed_districts: null })).toMatchObject({ ok: true });
  });
  it('dedupes areas and treats missing taluk as whole district', () => {
    const r = validateCreate({ ...valid, areas: [{ district: 'Ernakulam' }, { district: 'Ernakulam', taluk: '' }] }, op);
    expect(r.ok && r.fields.areas).toEqual([{ district: 'Ernakulam', taluk: null }]);
  });
});

describe('validatePatch', () => {
  it('allows partial updates', () => {
    expect(validatePatch({ status: 'restored' }, op)).toEqual({ ok: true, fields: { status: 'restored' } });
  });
  it('rejects empty patches and bad eta', () => {
    expect(validatePatch({}, op)).toMatchObject({ ok: false, field: 'body' });
    expect(validatePatch({ eta: 'tomorrow' }, op)).toMatchObject({ ok: false, field: 'eta' });
  });
});

describe('visibility', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('hides stale open updates and old restorations', () => {
    expect(isVisibleUpdate({ status: 'fixing', updated_at: '2026-10-13T11:00:00Z', resolved_at: null }, now)).toBe(true);
    expect(isVisibleUpdate({ status: 'fixing', updated_at: '2026-10-12T10:00:00Z', resolved_at: null }, now)).toBe(false);
    expect(isVisibleUpdate({ status: 'restored', updated_at: '2026-10-13T11:00:00Z', resolved_at: '2026-10-13T11:00:00Z' }, now)).toBe(true);
    expect(isVisibleUpdate({ status: 'restored', updated_at: '2026-10-13T09:00:00Z', resolved_at: '2026-10-13T09:00:00Z' }, now)).toBe(false);
  });
});

describe('parseBearer', () => {
  it('accepts only nu_op_ tokens', () => {
    expect(parseBearer('Bearer nu_op_' + 'a'.repeat(43))).toBe('nu_op_' + 'a'.repeat(43));
    expect(parseBearer('Bearer abc')).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});
