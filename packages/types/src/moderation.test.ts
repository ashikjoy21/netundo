import { describe, expect, it } from 'vitest';
import { moderateText } from './moderation';

describe('moderateText', () => {
  it.each(['stable for 2 years', 'drops every evening', 'Pandikkad area down since 6pm', 'Sree cable fixed it quickly', 'നെറ്റ് ഇല്ല രാവിലെ മുതൽ', 'Kunnamkulam down'])(
    'allows %s',
    (t) => expect(moderateText(t, 280).ok).toBe(true),
  );

  it.each(['this is shit', 'f.u.c.k this isp', 'FUUUUCK', 'sh1t service', 'myre ithu', 'Poori service', 'ഇത് മൈര് സർവീസ്'])(
    'blocks %s',
    (t) => expect(moderateText(t, 280)).toEqual({ ok: false, reason: 'profanity' }),
  );

  it('blocks links and phone numbers', () => {
    expect(moderateText('call 98470 12345 for cheap net', 280)).toMatchObject({ reason: 'phone' });
    expect(moderateText('visit cheapnet.in', 280)).toMatchObject({ reason: 'link' });
    expect(moderateText('https://x.com', 280)).toMatchObject({ reason: 'link' });
  });

  it('enforces length and trims', () => {
    expect(moderateText('   ', 280)).toMatchObject({ reason: 'empty' });
    expect(moderateText('a'.repeat(141), 140)).toMatchObject({ reason: 'too_long' });
    expect(moderateText('  ok  then ', 140)).toEqual({ ok: true, text: 'ok then' });
  });
});
