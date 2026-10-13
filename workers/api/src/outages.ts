/**
 * Outage reporting: request validation and "Right now" status aggregation.
 * Pure functions only (no I/O) so they can be unit-tested; the route handlers
 * in index.ts do the Supabase calls.
 */

import {
  brandBySlug,
  displayNameForKey,
  isKnownProviderSlug,
  moderateText,
  normalizeOperatorName,
  LCO_SLUG,
  OTHER_SLUG,
  type ConnectionKind,
} from '@netundo/types';
import TALUKS from './data/kerala-taluks.json';

export type OutageStatus = 'down' | 'slow' | 'dropping';
export const OUTAGE_STATUSES: OutageStatus[] = ['down', 'slow', 'dropping'];

/** Canonical district → taluk names (from the bundled boundary file). */
const TALUKS_BY_DISTRICT = new Map<string, Set<string>>();
for (const t of TALUKS as Array<{ d: string; t: string }>) {
  if (!TALUKS_BY_DISTRICT.has(t.d)) TALUKS_BY_DISTRICT.set(t.d, new Set());
  TALUKS_BY_DISTRICT.get(t.d)!.add(t.t);
}

export function isKnownTaluk(district: string, taluk: string): boolean {
  return TALUKS_BY_DISTRICT.get(district)?.has(taluk) ?? false;
}

export function isKnownDistrict(district: string): boolean {
  return TALUKS_BY_DISTRICT.has(district);
}

// ---------------------------------------------------------------------------
// Report validation
// ---------------------------------------------------------------------------

export interface ReportPayload {
  district?: unknown;
  taluk?: unknown;
  village?: unknown;
  provider?: { reported?: unknown; name?: unknown };
  kind?: unknown;
  status?: unknown;
  comment?: unknown;
  clientToken?: unknown;
}

export interface ValidReport {
  district: string;
  taluk: string;
  village: string | null;
  brandKey: string;
  providerName: string | null;
  kind: ConnectionKind;
  status: OutageStatus;
  comment: string | null;
  clientToken: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Brand key for a provider answer: a brand slug, or `lco:<name>` / `other:<name>`. */
export function brandKeyForAnswer(reported: string, name: string): { brandKey: string; providerName: string | null } | null {
  if (!isKnownProviderSlug(reported)) return null;
  if (reported === LCO_SLUG || reported === OTHER_SLUG) {
    // Operator names are shown publicly (headlines, share previews): moderate them.
    if (!moderateText(name, 60).ok) return null;
    const key = normalizeOperatorName(name);
    if (!key) return null;
    return { brandKey: `${reported}:${key}`, providerName: name.slice(0, 60) };
  }
  return { brandKey: reported, providerName: brandBySlug(reported)?.name ?? null };
}

export function validateReport(body: ReportPayload): { ok: true; report: ValidReport } | { ok: false; error: string; field: string } {
  const district = str(body.district);
  const taluk = str(body.taluk);
  if (!isKnownDistrict(district)) return { ok: false, error: 'Unknown district', field: 'district' };
  if (!isKnownTaluk(district, taluk)) return { ok: false, error: 'Unknown taluk for this district', field: 'taluk' };

  let village: string | null = null;
  if (str(body.village)) {
    const v = moderateText(str(body.village), 80);
    if (!v.ok) return { ok: false, error: 'Invalid village', field: 'village' };
    village = v.text;
  }

  const answer = brandKeyForAnswer(str(body.provider?.reported).toLowerCase(), str(body.provider?.name));
  if (!answer) return { ok: false, error: 'Choose a provider (and name it for a cable operator / other)', field: 'provider' };

  const kind = str(body.kind);
  if (kind !== 'broadband' && kind !== 'mobile') return { ok: false, error: 'kind must be broadband or mobile', field: 'kind' };

  const status = str(body.status) as OutageStatus;
  if (!OUTAGE_STATUSES.includes(status)) return { ok: false, error: 'status must be down, slow or dropping', field: 'status' };

  let comment: string | null = null;
  if (str(body.comment)) {
    const moderated = moderateText(str(body.comment), 140);
    if (!moderated.ok) return { ok: false, error: `comment: ${moderated.reason}`, field: 'comment' };
    comment = moderated.text;
  }

  const clientToken = typeof body.clientToken === 'string' ? body.clientToken : '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientToken)) return { ok: false, error: 'clientToken is required', field: 'clientToken' };

  return {
    ok: true,
    report: { district, taluk, village, brandKey: answer.brandKey, providerName: answer.providerName, kind, status, comment, clientToken },
  };
}

// ---------------------------------------------------------------------------
// Status aggregation
// ---------------------------------------------------------------------------

export interface ReportRow {
  district: string;
  taluk: string;
  village: string | null;
  brand_key: string;
  provider_name: string | null;
  kind: ConnectionKind;
  status: OutageStatus;
  comment: string | null;
  last_seen_at: string;
  ip_hash: string;
  client_token_hash: string;
}

export interface EventRow {
  id: string;
  district: string;
  taluk: string;
  brand_key: string;
  provider_name: string | null;
  kind: ConnectionKind;
  started_at: string;
  last_report_at: string;
  report_count: number;
  peak_reporters: number;
  top_village: string | null;
}

export interface StatusGroup {
  district: string;
  taluk: string;
  brand_key: string;
  provider: string;
  kind: ConnectionKind;
  /** Distinct reporters in the "Right now" window (max 2 counted per IP). */
  reporters: number;
  /** Distinct reporters inside the outage-detection window. */
  recent_reporters: number;
  /** Most reported status. */
  status: OutageStatus;
  statuses: Record<OutageStatus, number>;
  /** Village named by most reports, if any. */
  top_village: string | null;
  villages: Record<string, number>;
  last_report_at: string;
  likely_outage: boolean;
  outage_started_at: string | null;
}

export interface StatusComment {
  provider: string;
  kind: ConnectionKind;
  status: OutageStatus;
  village: string | null;
  taluk: string;
  text: string;
  at: string;
}

/** Distinct reporters, counting at most two client tokens per IP hash — the
 *  same rule submit_outage_report() uses in SQL. */
export function countReporters(rows: Array<Pick<ReportRow, 'ip_hash' | 'client_token_hash'>>): number {
  const perIp = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!perIp.has(r.ip_hash)) perIp.set(r.ip_hash, new Set());
    perIp.get(r.ip_hash)!.add(r.client_token_hash);
  }
  let total = 0;
  for (const tokens of perIp.values()) total += Math.min(tokens.size, 2);
  return total;
}

function topKey(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** Group recent reports by taluk + provider + kind and attach live outage flags.
 *
 * An event only counts as live while its last report is inside the detection
 * window, so a late cron run can never keep a stale "Likely outage" up. */
export function buildStatus(
  reports: ReportRow[],
  events: EventRow[],
  opts: { now: Date; outageWindowMin: number; minReports: number },
): { groups: StatusGroup[]; comments: StatusComment[] } {
  const outageCutoff = opts.now.getTime() - opts.outageWindowMin * 60_000;
  const liveEvents = new Map<string, EventRow>();
  for (const e of events) {
    if (new Date(e.last_report_at).getTime() >= outageCutoff) {
      liveEvents.set(`${e.district}|${e.taluk}|${e.brand_key}|${e.kind}`, e);
    }
  }

  const buckets = new Map<string, ReportRow[]>();
  for (const r of reports) {
    const key = `${r.district}|${r.taluk}|${r.brand_key}|${r.kind}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const groups: StatusGroup[] = [];
  for (const [key, rows] of buckets) {
    const first = rows[0];
    const statuses: Record<OutageStatus, number> = { down: 0, slow: 0, dropping: 0 };
    const villages: Record<string, number> = {};
    let last = first.last_seen_at;
    for (const r of rows) {
      statuses[r.status] += 1;
      if (r.village) villages[r.village] = (villages[r.village] ?? 0) + 1;
      if (r.last_seen_at > last) last = r.last_seen_at;
    }
    const recent = rows.filter((r) => new Date(r.last_seen_at).getTime() >= outageCutoff);
    // Live only while the threshold is still met inside the detection window.
    const event = countReporters(recent) >= opts.minReports ? (liveEvents.get(key) ?? null) : null;
    groups.push({
      district: first.district,
      taluk: first.taluk,
      brand_key: first.brand_key,
      provider: displayNameForKey(first.brand_key, first.provider_name),
      kind: first.kind,
      reporters: countReporters(rows),
      recent_reporters: countReporters(recent),
      status: (topKey(statuses) as OutageStatus) ?? 'down',
      statuses,
      top_village: event?.top_village ?? topKey(villages),
      villages,
      last_report_at: last,
      likely_outage: event != null,
      outage_started_at: event?.started_at ?? null,
    });
  }

  groups.sort(
    (a, b) =>
      Number(b.likely_outage) - Number(a.likely_outage) ||
      b.reporters - a.reporters ||
      b.last_report_at.localeCompare(a.last_report_at),
  );

  const comments: StatusComment[] = reports
    .filter((r) => r.comment)
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
    .slice(0, 8)
    .map((r) => ({
      provider: displayNameForKey(r.brand_key, r.provider_name),
      kind: r.kind,
      status: r.status,
      village: r.village,
      taluk: r.taluk,
      text: r.comment as string,
      at: r.last_seen_at,
    }));

  return { groups, comments };
}
