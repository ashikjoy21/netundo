/**
 * Operator updates API: validation and visibility rules (pure, testable).
 * Route handlers live in index.ts; the public contract is documented in
 * docs/operator-api.md.
 */

import { moderateText } from '@netundo/types';
import { isKnownDistrict, isKnownTaluk } from './outages';

export type OperatorStatus = 'investigating' | 'fixing' | 'restored';
export const OPERATOR_STATUSES: OperatorStatus[] = ['investigating', 'fixing', 'restored'];

/** Open updates disappear if not touched for this long. */
export const OPEN_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
/** "Restored" stays visible this long so people see the all-clear. */
export const RESTORED_VISIBLE_MS = 2 * 60 * 60 * 1000;

export interface OperatorRow {
  id: string;
  name: string;
  brand_key: string;
  allowed_districts: string[] | null;
  active: boolean;
}

export interface AreaInput {
  district: string;
  taluk: string | null;
}

export interface UpdateFields {
  status?: OperatorStatus;
  message?: string;
  eta?: string | null;
  kind?: 'broadband' | 'mobile' | null;
  areas?: AreaInput[];
  externalRef?: string | null;
}

type Result = { ok: true; fields: UpdateFields } | { ok: false; error: string; field: string };

function validateAreas(raw: unknown, operator: OperatorRow): { ok: true; areas: AreaInput[] } | { ok: false; error: string; field: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    return { ok: false, error: 'areas must be a list of 1–50 {district, taluk?} objects', field: 'areas' };
  }
  const seen = new Set<string>();
  const areas: AreaInput[] = [];
  for (const [i, item] of raw.entries()) {
    const district = typeof item?.district === 'string' ? item.district.trim() : '';
    const taluk = typeof item?.taluk === 'string' && item.taluk.trim() ? item.taluk.trim() : null;
    if (!isKnownDistrict(district)) return { ok: false, error: `Unknown district "${district}"`, field: `areas[${i}].district` };
    if (taluk && !isKnownTaluk(district, taluk)) return { ok: false, error: `Unknown taluk "${taluk}" in ${district}`, field: `areas[${i}].taluk` };
    if (operator.allowed_districts && !operator.allowed_districts.includes(district)) {
      return { ok: false, error: `This token can't post about ${district}`, field: `areas[${i}].district` };
    }
    const key = `${district}|${taluk ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      areas.push({ district, taluk });
    }
  }
  return { ok: true, areas };
}

function validateCommon(body: Record<string, unknown>, operator: OperatorRow, partial: boolean): Result {
  const fields: UpdateFields = {};

  if (body.status !== undefined || !partial) {
    if (!OPERATOR_STATUSES.includes(body.status as OperatorStatus)) {
      return { ok: false, error: 'status must be investigating, fixing or restored', field: 'status' };
    }
    fields.status = body.status as OperatorStatus;
  }

  if (body.message !== undefined || !partial) {
    const moderated = moderateText(typeof body.message === 'string' ? body.message : '', 500);
    if (!moderated.ok) {
      const reason = moderated.reason === 'empty' ? 'message is required' : `message rejected: ${moderated.reason}`;
      return { ok: false, error: reason, field: 'message' };
    }
    if (moderated.text.length < 3) return { ok: false, error: 'message is too short', field: 'message' };
    fields.message = moderated.text;
  }

  if (body.eta !== undefined) {
    if (body.eta === null) fields.eta = null;
    else {
      const t = typeof body.eta === 'string' ? Date.parse(body.eta) : NaN;
      if (!Number.isFinite(t)) return { ok: false, error: 'eta must be an ISO 8601 timestamp or null', field: 'eta' };
      fields.eta = new Date(t).toISOString();
    }
  }

  if (body.kind !== undefined) {
    if (body.kind !== null && body.kind !== 'broadband' && body.kind !== 'mobile') {
      return { ok: false, error: 'kind must be broadband, mobile or null (both)', field: 'kind' };
    }
    fields.kind = body.kind as UpdateFields['kind'];
  }

  if (body.areas !== undefined || !partial) {
    const areas = validateAreas(body.areas, operator);
    if (!areas.ok) return areas;
    fields.areas = areas.areas;
  }

  if (body.external_ref !== undefined) {
    if (body.external_ref !== null && (typeof body.external_ref !== 'string' || body.external_ref.length > 100)) {
      return { ok: false, error: 'external_ref must be a string of at most 100 characters', field: 'external_ref' };
    }
    fields.externalRef = body.external_ref as string | null;
  }

  if (partial && Object.keys(fields).length === 0) {
    return { ok: false, error: 'Nothing to update', field: 'body' };
  }
  return { ok: true, fields };
}

export function validateCreate(body: Record<string, unknown>, operator: OperatorRow): Result {
  return validateCommon(body, operator, false);
}

export function validatePatch(body: Record<string, unknown>, operator: OperatorRow): Result {
  return validateCommon(body, operator, true);
}

export interface UpdateRow {
  id: string;
  brand_key: string;
  kind: 'broadband' | 'mobile' | null;
  status: OperatorStatus;
  message: string;
  eta: string | null;
  external_ref?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  operators?: { name: string } | null;
  operator_update_areas?: AreaInput[];
}

/** Whether an update should still be shown publicly. */
export function isVisibleUpdate(u: Pick<UpdateRow, 'status' | 'updated_at' | 'resolved_at'>, now: Date): boolean {
  const t = now.getTime();
  if (u.status === 'restored') {
    return Date.parse(u.resolved_at ?? u.updated_at) >= t - RESTORED_VISIBLE_MS;
  }
  return Date.parse(u.updated_at) >= t - OPEN_UPDATE_TTL_MS;
}

/** Public shape (no operator ids or internal refs). */
export function publicUpdate(u: UpdateRow, providerName: string) {
  return {
    id: u.id,
    operator: u.operators?.name ?? providerName,
    provider: providerName,
    brand_key: u.brand_key,
    kind: u.kind,
    status: u.status,
    message: u.message,
    eta: u.eta,
    updated_at: u.updated_at,
    areas: u.operator_update_areas ?? [],
  };
}

/** Bearer token format: nu_op_ + 43 base64url chars (32 random bytes). */
export function parseBearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(nu_op_[A-Za-z0-9_-]{32,64})$/);
  return m ? m[1] : null;
}
