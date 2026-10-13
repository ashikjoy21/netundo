/**
 * Tunable thresholds for how much data a page needs before it shows (or ranks)
 * something. Read at build time; override with env vars in the Pages build.
 */

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Minimum public tests before an area page is indexable and listed in the sitemap. */
export const INDEX_MIN_TESTS = intEnv(process.env.NETUNDO_INDEX_MIN_TESTS, 5);

/** Below this many tests, FAQ/intro copy never names a "fastest provider". */
export const FAQ_MIN_TESTS = intEnv(process.env.NETUNDO_FAQ_MIN_TESTS, 5);

/** Below this many tests, "fastest provider" copy is hedged as early data. */
export const FAQ_HEDGE_BELOW = intEnv(process.env.NETUNDO_FAQ_HEDGE_BELOW, 30);

/** Minimum tests for a network to be ranked; fewer go in the "Early data" list. */
export const RANK_MIN_TESTS = intEnv(process.env.NEXT_PUBLIC_RANK_MIN_TESTS, 10);
