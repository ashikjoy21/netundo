import { describe, expect, it } from 'vitest';
import { MissingSaltError, dailyIpHash, tokenHash } from './privacy';

describe('dailyIpHash', () => {
  const env = { IP_HASH_SALT: 'test-secret' };
  it('is stable within a day and rotates across days', async () => {
    const a = await dailyIpHash('1.2.3.4', env, new Date('2026-10-13T01:00:00Z'));
    const b = await dailyIpHash('1.2.3.4', env, new Date('2026-10-13T23:00:00Z'));
    const c = await dailyIpHash('1.2.3.4', env, new Date('2026-10-14T01:00:00Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('depends on the secret', async () => {
    const d = new Date('2026-10-13T01:00:00Z');
    expect(await dailyIpHash('1.2.3.4', env, d)).not.toBe(await dailyIpHash('1.2.3.4', { IP_HASH_SALT: 'other' }, d));
  });
  it('refuses to hash without the secret', async () => {
    await expect(dailyIpHash('1.2.3.4', {})).rejects.toBeInstanceOf(MissingSaltError);
  });
  it('hashes tokens', async () => {
    expect(await tokenHash('abc', env)).toMatch(/^[0-9a-f]{64}$/);
  });
});
