/**
 * Server-rendered outage status page for share links
 * (/status/{district}/{taluk}/{brand}[?kind=mobile]).
 *
 * Rendered by the Pages Function in apps/web/functions/status/[[path]].ts so
 * WhatsApp/Facebook/X crawlers (which don't run JS) get real Open Graph tags.
 * Pure string building — no Next.js, no React — so the function stays tiny.
 */

import {
  KERALA_DISTRICTS,
  KERALA_TALUKS,
  STATUS_LABELS,
  displayNameForKey,
  outageHeadline,
  segmentToBrandKey,
  slugifyPlace,
  type ConnectionKind,
  type OutageStatusWord,
} from '@netundo/types';

export interface StatusGroupLite {
  brand_key: string;
  provider: string;
  kind: ConnectionKind;
  reporters: number;
  recent_reporters: number;
  status: OutageStatusWord;
  top_village: string | null;
  likely_outage: boolean;
  last_report_at: string;
}

export interface ResolvedStatusPath {
  district: string;
  taluk: string;
  brandKey: string;
  kind: ConnectionKind;
}

/** Map /status/{district}/{taluk}/{brand} slugs back to canonical names. */
export function resolveStatusPath(segments: string[], kindParam: string | null): ResolvedStatusPath | null {
  if (segments.length !== 3) return null;
  let decoded: string[];
  try {
    decoded = segments.map((s) => decodeURIComponent(s).toLowerCase());
  } catch {
    return null; // malformed %-escape → 404
  }
  const [districtSlug, talukSlug, brandSegment] = decoded;
  const district = KERALA_DISTRICTS.find((d) => slugifyPlace(d) === districtSlug);
  if (!district) return null;
  const taluk = KERALA_TALUKS[district]?.find((t) => slugifyPlace(t) === talukSlug);
  if (!taluk) return null;
  if (!/^[a-z0-9.\-ഀ-ൿ]{1,80}$/.test(brandSegment)) return null;
  return {
    district,
    taluk,
    brandKey: segmentToBrandKey(brandSegment),
    kind: kindParam === 'mobile' ? 'mobile' : 'broadband',
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface StatusPageModel {
  title: string;
  description: string;
  image: string;
  status: OutageStatusWord | 'none';
  likely: boolean;
}

/** Title/description/image for the share preview. */
export function statusPageModel(
  path: ResolvedStatusPath,
  group: StatusGroupLite | null,
  windowMin: number,
): StatusPageModel {
  const kindLabel = path.kind === 'mobile' ? 'mobile data' : 'home broadband';
  const provider = group?.provider ?? displayNameForKey(path.brandKey);
  if (!group || group.reporters === 0) {
    return {
      title: `Is ${provider} down in ${path.taluk}? No reports right now`,
      description: `No one has reported ${provider} ${kindLabel} problems in ${path.taluk}, ${path.district} in the last hour. Net illa? Report it on netundo.`,
      image: '/og/outage-none.png',
      status: 'none',
      likely: false,
    };
  }
  const place = group.top_village ?? path.taluk;
  const reporters = group.likely_outage ? group.recent_reporters || group.reporters : group.reporters;
  const title = outageHeadline({
    reporters,
    provider,
    place,
    status: group.status,
    windowMin: group.likely_outage ? windowMin : 60,
  });
  const lead = group.likely_outage ? 'Likely outage' : 'Reported problem';
  return {
    title,
    description: `${lead} · ${provider} ${kindLabel} · ${path.taluk}, ${path.district}. Is it ${STATUS_LABELS[group.status].phrase} for you too? Tap to see live reports or add yours.`,
    image: `/og/outage-${group.status}.png`,
    status: group.status,
    likely: group.likely_outage,
  };
}

/** Full HTML document: OG tags + a light, readable page for humans. */
export function renderStatusPage(opts: {
  origin: string;
  canonicalPath: string;
  path: ResolvedStatusPath;
  model: StatusPageModel;
  group: StatusGroupLite | null;
}): string {
  const { origin, canonicalPath, path, model, group } = opts;
  const e = escapeHtml;
  const url = `${origin}${canonicalPath}`;
  const image = `${origin}${model.image}`;
  const areaBase = `/kerala/${slugifyPlace(path.district)}/${slugifyPlace(path.taluk)}`;
  const areaHref = `${areaBase}#right-now`;
  const reportHref = `${areaBase}#report`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${model.title}. Is it down for you too?\n${url}`)}`;
  const pill = model.likely
    ? '<span class="pill red">Likely outage</span>'
    : group
      ? '<span class="pill amber">Reported</span>'
      : '<span class="pill green">No reports</span>';
  const updated = group
    ? `<p class="muted">Last report ${e(new Date(group.last_report_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }))} IST</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(model.title)} | netundo</title>
<meta name="description" content="${e(model.description)}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="netundo">
<meta property="og:title" content="${e(model.title)}">
<meta property="og:description" content="${e(model.description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:secure_url" content="${e(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(model.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(model.title)}">
<meta name="twitter:description" content="${e(model.description)}">
<meta name="twitter:image" content="${e(image)}">
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff7f2;color:#111827;line-height:1.45}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px}
a.brand{font-weight:800;color:#f6821f;text-decoration:none;font-size:20px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:20px;margin-top:16px}
h1{font-size:24px;line-height:1.2;margin:10px 0 6px}
.pill{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700}
.red{background:#dc2626;color:#fff}.amber{background:#fef3c7;color:#92400e}.green{background:#dcfce7;color:#166534}
.muted{color:#6b7280;font-size:14px;margin:4px 0}
.btn{display:block;text-align:center;border-radius:16px;padding:14px;font-weight:800;text-decoration:none;margin-top:12px}
.report{background:#dc2626;color:#fff}.wa{background:#25d366;color:#fff}.ghost{border:1px solid #e5e7eb;color:#111827;background:#fff}
small{display:block;font-weight:500;opacity:.9}
</style>
</head>
<body>
<main>
<a class="brand" href="/">netundo</a>
<div class="card">
${pill}
<h1>${e(model.title)}</h1>
<p class="muted">${e(path.kind === 'mobile' ? 'Mobile data' : 'Home broadband')} · ${e(path.taluk)}, ${e(path.district)}</p>
${updated}
<a class="btn report" href="${e(reportHref)}">Net illa? Report it too<small>നെറ്റ് ഇല്ലേ? റിപ്പോർട്ട് ചെയ്യൂ</small></a>
<a class="btn wa" href="${e(whatsapp)}">Share on WhatsApp</a>
<a class="btn ghost" href="${e(areaHref)}">See everything reported in ${e(path.taluk)}</a>
</div>
<p class="muted" style="margin-top:16px">Crowdsourced, anonymous reports. A provider is marked a likely outage when several people in the same taluk report it within a short window.</p>
</main>
</body>
</html>`;
}
