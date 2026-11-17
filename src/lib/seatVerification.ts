// P0.3 seat-level World ID verification — pure resolver over the
// /api/seat-grants feed body (t_d1c1cf68 badge UI slice).
// Contract frozen with the API slice (t_1681436c): the seat feed exposes
//   { grants?: Record<walletLower, { nullifier }>, indexed?: boolean }
// per bill, where `indexed: true` means the grant index is live (an absent
// wallet is an explicit NOT-verified) and `indexed` absent/false means the
// data is unavailable (neutral state, never an error). Zero UI/chain deps
// so badge tests can pin every state without a DOM or network.
export type SeatVerification = 'verified' | 'unverified' | 'unknown';

// 0[xX] so fully-uppercased forms ("0XAAA…") still parse as addresses.
const ADDRESS_RE = /^0[xX][a-fA-F0-9]{40}$/;

/** Feed body as seen by the client: anything from json() is allowed in,
 *  because a malformed body must resolve to 'unknown', never crash. */
export type SeatGrantsFeed = {
  grants?: unknown;
  indexed?: unknown;
} | null | undefined;

/**
 * Wallet -> tri-state badge status.
 *  - 'verified'   : index live AND wallet present in grants
 *  - 'unverified' : index live AND wallet explicitly absent
 *  - 'unknown'    : feed/index missing or malformed (missing data tolerated)
 * Never throws on missing/invalid fields; invalid wallets resolve 'unknown'.
 */
export function resolveSeatVerification(
  feed: SeatGrantsFeed,
  wallet?: string,
): SeatVerification {
  if (typeof wallet !== 'string' || !ADDRESS_RE.test(wallet)) return 'unknown';
  if (!feed || typeof feed !== 'object') return 'unknown';
  // Only a strict boolean-true counts as a live index (anything else is
  // "data missing" -> neutral, per acceptance criteria).
  if (feed.indexed !== true) return 'unknown';
  const grants = feed.grants;
  if (typeof grants !== 'object' || grants === null) return 'unknown';
  const lower = wallet.toLowerCase();
  // Explicit key scan — `in` would also hit Object.prototype members.
  for (const k of Object.keys(grants as Record<string, unknown>)) {
    if (k.toLowerCase() === lower) return 'verified';
  }
  return 'unverified';
}

/** boolean|null form consumed by SeatRow.verified (stable legacy shape). */
export function verificationToFlag(v: SeatVerification): boolean | null {
  return v === 'verified' ? true : v === 'unverified' ? false : null;
}

/** Inverse: SeatRow.verified flag -> badge state for rendering. */
export function flagToVerification(v: boolean | null | undefined): SeatVerification {
  return v === true ? 'verified' : v === false ? 'unverified' : 'unknown';
}
