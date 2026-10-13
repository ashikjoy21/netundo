import { describe, expect, it } from 'vitest';
import { fastestFaq, localizedFaq, localizedIntro, type AreaProseInput, type MetricSummary } from './localityData';
import type { ScoredNetwork } from './networkScore';

const leader = { name: 'Kerala Vision', downloadMbps: 80 } as ScoredNetwork;
const summary = (samples: number): MetricSummary => ({ samples, downloadMbps: 80, uploadMbps: 40, latencyMs: 20 });
const input = (bb: number): AreaProseInput => ({
  name: 'Kakkanad',
  parent: 'Kanayannor',
  totalSamples: bb,
  broadband: summary(bb),
  mobile: summary(0),
  providers: { broadband: [leader], mobile: [] },
});

describe('fastest-provider copy', () => {
  it('omits the claim below the minimum sample', () => {
    expect(fastestFaq('Kakkanad', leader, summary(4), 'home broadband', 'broadband')).toBeNull();
    expect(localizedFaq(input(4)).some((f) => f.question.startsWith('Which is the fastest'))).toBe(false);
  });

  it('hedges with "early data from N tests" on a small sample', () => {
    const faq = fastestFaq('Kakkanad', leader, summary(12), 'home broadband', 'broadband');
    expect(faq?.answer).toMatch(/^Based on early data from 12 broadband tests/);
  });

  it('states it plainly once the sample is large', () => {
    const faq = fastestFaq('Kakkanad', leader, summary(40), 'home broadband', 'broadband');
    expect(faq?.answer).toMatch(/^Based on 40 community broadband tests/);
  });

  it('never names a leader in the intro below the minimum', () => {
    expect(localizedIntro({ ...input(4), totalSamples: 6 })).not.toContain('Kerala Vision');
    expect(localizedIntro(input(12))).toMatch(/early/i);
  });
});
