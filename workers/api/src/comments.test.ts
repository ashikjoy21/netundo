import { describe, expect, it } from 'vitest';
import { validateComment } from './comments';

const base = {
  district: 'Ernakulam',
  taluk: 'Kanayannor',
  village: 'Kakkanad',
  provider: { reported: 'asianet' },
  kind: 'broadband',
  body: 'Stable for 2 years, drops a bit in heavy rain',
  clientToken: 'abcdefghijklmnop1234',
};

describe('validateComment', () => {
  it('accepts a normal review', () => {
    expect(validateComment(base)).toMatchObject({ ok: true, comment: { brandKey: 'asianet', body: base.body } });
  });
  it('blocks abuse, links and phone numbers with a friendly message', () => {
    expect(validateComment({ ...base, body: 'total shit service' })).toMatchObject({ ok: false, field: 'body' });
    expect(validateComment({ ...base, body: 'switch to cheapnet.in' })).toMatchObject({ ok: false, field: 'body', error: 'Links aren’t allowed in comments.' });
    expect(validateComment({ ...base, body: 'call 9847012345' })).toMatchObject({ ok: false, field: 'body' });
  });
  it('limits length to 280', () => {
    expect(validateComment({ ...base, body: 'a'.repeat(281) })).toMatchObject({ ok: false, field: 'body' });
  });
  it('supports LCO comments', () => {
    expect(validateComment({ ...base, provider: { reported: 'lco', name: 'Sree Cable' } })).toMatchObject({
      ok: true,
      comment: { brandKey: 'lco:sree-cable' },
    });
  });
});
