import { describe, expect, it } from 'vitest';
import { allVillageParams, findVillage } from './slug';

describe('village slugs', () => {
  it('are unique within each taluk, so every village gets its own URL', () => {
    const keys = allVillageParams().map((p) => `${p.district}/${p.taluk}/${p.village}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => !k.endsWith('/'))).toBe(true);
  });

  it('round-trips through findVillage', () => {
    for (const p of allVillageParams().slice(0, 200)) {
      expect(findVillage(p.district, p.taluk, p.village)?.villageSlug).toBe(p.village);
    }
  });
});
