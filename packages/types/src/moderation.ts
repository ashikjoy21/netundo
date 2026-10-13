// Basic text moderation for user-written outage comments and area reviews.
// Deliberately small and conservative: it blocks obvious abuse, links and
// phone numbers (spam), and leaves anything subtle to the "report comment"
// button. Extend the lists by PR.

/** Latin-script terms (English + common Manglish), matched as whole words so
 *  place names that merely contain them (e.g. "Pandikkad") are not blocked. */
const LATIN_TERMS = [
  // English
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard',
  'asshole', 'dick', 'cunt', 'whore', 'slut', 'retard',
  // Manglish (Malayalam written in Latin script)
  'myre', 'myr', 'myru', 'myran', 'mairu', 'maire', 'mayire', 'poori', 'pooru', 'poorimone', 'poorimon',
  'thayoli', 'thaayoli', 'thayoliye', 'kunna', 'kunne', 'kunnanu', 'punda', 'pundi', 'pundachi',
  'oombi', 'oombu', 'oombiya', 'koothi', 'koothichi', 'kazhuveri', 'kazhuverude', 'veshya', 'thevidichi',
  // Hindi slurs commonly seen in Indian comment sections
  'chutiya', 'chutiye', 'madarchod', 'behenchod', 'bhosdike', 'randi',
];

/** Malayalam-script stems, matched as substrings (no reliable word boundaries). */
const MALAYALAM_TERMS = ['മൈര്', 'മൈരൻ', 'മൈരെ', 'പൂറ്', 'പൂറി', 'തായോളി', 'കുണ്ണ', 'പുണ്ട', 'ഊമ്പ', 'കൂതി', 'വേശ്യ', 'കഴുവേറി'];

const LATIN_RE = new RegExp(`(^|[^a-z])(${LATIN_TERMS.join('|')})(?=$|[^a-z])`, 'i');
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|me|xyz|co|info|link|ly)\b)/i;
// 10+ digits, allowing spaces/dashes between them (Indian mobile numbers).
const PHONE_RE = /(\d[\s-]?){10,}/;

export type ModerationResult = { ok: true; text: string } | { ok: false; reason: 'profanity' | 'link' | 'phone' | 'empty' | 'too_long' };

/** Normalise leetspeak and stretched letters ("fuuuuck", "sh1t") before matching. */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/\$/g, 's')
    .replace(/([a-z])\1{2,}/g, '$1$1')
    .replace(/[*_.]/g, '');
}

export function moderateText(raw: string | null | undefined, maxLength: number): ModerationResult {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > maxLength) return { ok: false, reason: 'too_long' };
  if (LINK_RE.test(text)) return { ok: false, reason: 'link' };
  if (PHONE_RE.test(text)) return { ok: false, reason: 'phone' };

  const norm = normalizeForMatching(text);
  const squashed = norm.replace(/([a-z])\1+/g, '$1');
  if (LATIN_RE.test(norm) || LATIN_RE.test(squashed)) return { ok: false, reason: 'profanity' };
  if (MALAYALAM_TERMS.some((term) => text.includes(term))) return { ok: false, reason: 'profanity' };

  return { ok: true, text };
}

export const MODERATION_MESSAGES: Record<Exclude<ModerationResult, { ok: true }>['reason'], string> = {
  profanity: 'Please keep it clean — that comment contains language we don’t allow.',
  link: 'Links aren’t allowed in comments.',
  phone: 'Phone numbers aren’t allowed in comments.',
  empty: 'Comment is empty.',
  too_long: 'Comment is too long.',
};
