/** Community comments: request validation (pure). Routes are in index.ts. */

import { moderateText, MODERATION_MESSAGES, type ConnectionKind } from '@netundo/types';
import { brandKeyForAnswer, isKnownDistrict, isKnownTaluk } from './outages';

export interface ValidComment {
  district: string;
  taluk: string;
  village: string | null;
  brandKey: string;
  providerName: string | null;
  kind: ConnectionKind;
  body: string;
  clientToken: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function validateComment(
  input: Record<string, unknown>,
): { ok: true; comment: ValidComment } | { ok: false; error: string; field: string } {
  const district = str(input.district);
  const taluk = str(input.taluk);
  if (!isKnownDistrict(district)) return { ok: false, error: 'Unknown district', field: 'district' };
  if (!isKnownTaluk(district, taluk)) return { ok: false, error: 'Unknown taluk for this district', field: 'taluk' };

  const provider = (input.provider ?? {}) as { reported?: unknown; name?: unknown };
  const answer = brandKeyForAnswer(str(provider.reported).toLowerCase(), str(provider.name));
  if (!answer) return { ok: false, error: 'Choose a provider (and name it for a cable operator / other)', field: 'provider' };

  const kind = str(input.kind);
  if (kind !== 'broadband' && kind !== 'mobile') return { ok: false, error: 'kind must be broadband or mobile', field: 'kind' };

  const moderated = moderateText(str(input.body), 280);
  if (!moderated.ok) return { ok: false, error: MODERATION_MESSAGES[moderated.reason], field: 'body' };
  if (moderated.text.length < 3) return { ok: false, error: 'Comment is too short.', field: 'body' };

  const clientToken = typeof input.clientToken === 'string' ? input.clientToken : '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientToken)) return { ok: false, error: 'clientToken is required', field: 'clientToken' };

  return {
    ok: true,
    comment: {
      district,
      taluk,
      village: str(input.village).slice(0, 80) || null,
      brandKey: answer.brandKey,
      providerName: answer.providerName,
      kind,
      body: moderated.text,
      clientToken,
    },
  };
}
