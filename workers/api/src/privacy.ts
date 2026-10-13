/**
 * Privacy-preserving identifiers for abuse control (dedupe + rate limits).
 *
 * New tables (outage reports, comments) store an HMAC of the IP keyed with the
 * IP_HASH_SALT secret and the current UTC day. Without the secret the hashes
 * can't be brute-forced back to IPs (unlike a fixed public salt), and because
 * the key rotates daily, hashes from different days can't be linked.
 */

export interface PrivacyEnv {
  IP_HASH_SALT?: string;
}

let warned = false;

async function hmacHex(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function salt(env: PrivacyEnv): string {
  if (env.IP_HASH_SALT) return env.IP_HASH_SALT;
  if (!warned) {
    console.warn('IP_HASH_SALT is not set; using an insecure development salt.');
    warned = true;
  }
  return 'netundo-dev-only-salt';
}

/** Daily-rotating keyed hash of the caller's IP. */
export async function dailyIpHash(ip: string, env: PrivacyEnv, now = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  return hmacHex(`${salt(env)}|${day}`, ip);
}

/** Keyed hash of a client token (random per-browser string). */
export async function tokenHash(token: string, env: PrivacyEnv): Promise<string> {
  return hmacHex(salt(env), `token|${token}`);
}
