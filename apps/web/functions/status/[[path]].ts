/**
 * Pages Function: /status/{district}/{taluk}/{brand}[?kind=mobile]
 *
 * Shareable outage status with Open Graph tags for WhatsApp link previews.
 * Fetches live state from the API worker and returns a small HTML page
 * (cached 60 s at the edge). Everything else on the site stays static.
 */

import { renderStatusPage, resolveStatusPath, statusPageModel, type StatusGroupLite } from '../../src/lib/statusPage';

interface Env {
  /** API worker origin; defaults to production. */
  NETUNDO_API_URL?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

export async function onRequestGet({ request, env, params }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const path = resolveStatusPath(segments, url.searchParams.get('kind'));
  if (!path) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  const api = (env.NETUNDO_API_URL ?? 'https://api.netundo.com').replace(/\/$/, '');
  let group: StatusGroupLite | null = null;
  let windowMin = 30;
  try {
    const res = await fetch(`${api}/v1/status?${new URLSearchParams({ district: path.district, taluk: path.taluk })}`, {
      cf: { cacheTtl: 30 },
    } as RequestInit);
    if (res.ok) {
      const body = (await res.json()) as { groups?: StatusGroupLite[]; outage_window_min?: number };
      group = body.groups?.find((g) => g.brand_key === path.brandKey && g.kind === path.kind) ?? null;
      windowMin = body.outage_window_min ?? 30;
    }
  } catch {
    // API unreachable: still render a useful page with a neutral preview.
  }

  const canonicalPath = `${url.pathname}${path.kind === 'mobile' ? '?kind=mobile' : ''}`;
  const html = renderStatusPage({
    origin: url.origin,
    canonicalPath,
    path,
    model: statusPageModel(path, group, windowMin),
    group,
  });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
