import { describe, expect, it } from 'vitest';
import { escapeHtml, renderStatusPage, resolveStatusPath, statusPageModel, type StatusGroupLite } from './statusPage';

const group: StatusGroupLite = {
  brand_key: 'kerala-vision',
  provider: 'Kerala Vision',
  kind: 'broadband',
  reporters: 5,
  recent_reporters: 5,
  status: 'down',
  top_village: 'Kakkanad',
  likely_outage: true,
  last_report_at: '2026-10-13T12:00:00Z',
};

describe('status share page', () => {
  it('resolves slugs back to canonical places', () => {
    expect(resolveStatusPath(['ernakulam', 'kanayannor', 'kerala-vision'], null)).toEqual({
      district: 'Ernakulam',
      taluk: 'Kanayannor',
      brandKey: 'kerala-vision',
      kind: 'broadband',
    });
    expect(resolveStatusPath(['ernakulam', 'kanayannor', 'lco.sree-cable'], 'mobile')?.brandKey).toBe('lco:sree-cable');
    expect(resolveStatusPath(['ernakulam', 'nowhere', 'jio'], null)).toBeNull();
    expect(resolveStatusPath(['ernakulam', 'kanayannor'], null)).toBeNull();
  });

  it('builds the WhatsApp preview from live counts', () => {
    const path = resolveStatusPath(['ernakulam', 'kanayannor', 'kerala-vision'], null)!;
    const model = statusPageModel(path, group, 30);
    expect(model.title).toBe('5 people reported Kerala Vision down in Kakkanad in the last 30 min');
    expect(model.image).toBe('/og/outage-down.png');
    const html = renderStatusPage({ origin: 'https://netundo.com', canonicalPath: '/status/ernakulam/kanayannor/kerala-vision', path, model, group });
    expect(html).toContain('<meta property="og:title" content="5 people reported Kerala Vision down in Kakkanad in the last 30 min">');
    expect(html).toContain('content="https://netundo.com/og/outage-down.png"');
    expect(html).toContain('noindex');
  });

  it('has a neutral preview when nothing is reported', () => {
    const path = resolveStatusPath(['ernakulam', 'kanayannor', 'jio'], 'mobile')!;
    const model = statusPageModel(path, null, 30);
    expect(model.title).toBe('Is Jio down in Kanayannor? No reports right now');
    expect(model.image).toBe('/og/outage-none.png');
  });

  it('escapes user-supplied operator names', () => {
    const path = resolveStatusPath(['ernakulam', 'kanayannor', 'lco.x'], null)!;
    const evil = { ...group, brand_key: 'lco:x', provider: '<script>alert(1)</script>' };
    const html = renderStatusPage({ origin: 'https://n.com', canonicalPath: '/s', path, model: statusPageModel(path, evil, 30), group: evil });
    expect(html).not.toContain('<script>alert');
    expect(escapeHtml('"<&>\'')).toBe('&quot;&lt;&amp;&gt;&#39;');
  });
});
