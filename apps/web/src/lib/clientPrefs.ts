/**
 * Small per-browser preferences kept in localStorage. Every access is wrapped in
 * try/catch: private mode and blocked storage must never break a page.
 */

const TOKEN_KEY = 'netundo:client-token';
const PROVIDER_KEY = 'netundo:provider';
const AREA_KEY = 'netundo:area';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the preference just won't be remembered.
  }
}

/** Random, anonymous per-browser token used to dedupe reports and to let this
 *  browser edit its own test result. Only its hash is stored server-side. */
export function getClientToken(): string {
  const existing = read(TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  write(TOKEN_KEY, token);
  return token;
}

export interface SavedProvider {
  /** Brand slug, 'lco' or 'other'. */
  reported: string;
  name?: string;
  kind?: 'broadband' | 'mobile';
}

export function getSavedProvider(): SavedProvider | null {
  try {
    const parsed = JSON.parse(read(PROVIDER_KEY) ?? 'null') as SavedProvider | null;
    return parsed && typeof parsed.reported === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProvider(provider: SavedProvider): void {
  write(PROVIDER_KEY, JSON.stringify(provider));
}

export interface SavedArea {
  district: string;
  taluk?: string;
  village?: string;
}

export function getSavedArea(): SavedArea | null {
  try {
    const parsed = JSON.parse(read(AREA_KEY) ?? 'null') as SavedArea | null;
    return parsed && typeof parsed.district === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveArea(area: SavedArea): void {
  write(AREA_KEY, JSON.stringify(area));
}
