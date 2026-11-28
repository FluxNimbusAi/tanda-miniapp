// KAIZEN-9 (t_5dbc6910) — the username-over-address DISPLAY LAW, one pure
// module. World mini-app guidelines (docs.world.org/mini-apps/guidelines/
// app-guidelines, verified live 2026-11-27) state two binding clauses:
//   1. "When a user is authenticated through their wallet, always show
//      their username instead of the wallet address"
//   2. "You should avoid displaying the user's wallet address, use their
//      username instead."
// Scope: IDENTITY surfaces only (roster badges, pending-seat burn list,
// settlement trail "who receives what"). Address-as-TARGET surfaces (bill
// links, tx-hash receipts, the queried address itself) are compliant by
// design and must NOT route through this module.
//
// Fail-soft doctrine mirrors W2.5-4 loadBadges: username resolution is an
// enhancement, never a gate. An unregistered handle, a service outage, or an
// absent map keeps the canonical short address — identityLabel ALWAYS returns
// a renderable string, no row ever blanks.

/** Canonical short form — same bytes as the settlementVector golden lane. */
export const shortAddress = (wallet: string): string =>
  `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

/**
 * The law as one pure function: @username when a World username is known
 * for the wallet, canonical short address otherwise. Blank/whitespace
 * usernames count as unknown (defensive against empty-string drift from a
 * feed layer).
 */
export function identityLabel(wallet: string, username?: string): string {
  const u = username?.trim();
  return u ? `@${u}` : shortAddress(wallet);
}

/** Wallet -> username map. Keys MUST be lowercased (checksum-insensitive
 *  lookup, same convention as lookupUsernamesForWallets' return map). */
export type NamesByWallet = Map<string, string>;

/** Fold resolved seat rows into a display map (rows without a username are
 *  skipped, so the fallback path stays honest). */
export function namesFromSeats(
  seats: readonly { wallet: string; username?: string }[],
): NamesByWallet {
  const m: NamesByWallet = new Map();
  for (const s of seats) {
    if (s.username) m.set(s.wallet.toLowerCase(), s.username);
  }
  return m;
}

/** Lookup + law in one call. An undefined map (feed never resolved) is a
 *  legitimate fail-soft input: every wallet keeps its short address. */
export function labelFor(
  names: NamesByWallet | undefined,
  wallet: string,
): string {
  return identityLabel(wallet, names?.get(wallet.toLowerCase()));
}
