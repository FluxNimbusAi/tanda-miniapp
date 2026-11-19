// W2.5-4 (t_edd4a5e9) — per-bill invite deep-link builder.
// Universal-link schema live-verified 2026-11-19 @
// docs.world.org/mini-apps/sharing/quick-actions:
//     https://world.org/mini-app?app_id={app_id}&path={url-encoded path}
// With World App installed it opens the mini app directly on {path}; without
// it the link degrades to the app-store page — the exact behavior an invite
// needs. (Notifications keep using the worldapp:// form in /api/notify; the
// https:// form is the SHAREABLE one.)
//
// The landing path is /bill/{address} — the deep-link route added by this
// slice ((protected)/bill/[address]). UI-only: nothing here touches the bill
// state machine.
import { getAddress, isAddress, type Address } from 'viem';

/** World developer-portal app ids are `app_` + opaque alphanumerics
 *  (live sample: app_e691f66620f3537878f639160a0e31f7, m4_hosting E5).
 *  Bounded regex guards a malformed env from ever reaching a share sheet. */
export const WORLD_APP_ID_RE = /^app_[A-Za-z0-9]{8,64}$/;

/** Canonical in-mini-app path for a bill. EIP-55 checksum form -> the SAME
 *  url from any pasted casing (deterministic, golden-testable). */
export function billInvitePath(bill: Address): string {
  if (!isAddress(bill))
    throw new RangeError(`invite: not a valid bill address: ${bill}`);
  return `/bill/${getAddress(bill)}`;
}

/** Shareable universal invite link for one bill. */
export function buildBillInviteUrl(bill: Address, appId: string): string {
  if (!WORLD_APP_ID_RE.test(appId))
    throw new RangeError(`invite: invalid World app_id: ${appId}`);
  return `https://world.org/mini-app?app_id=${appId}&path=${encodeURIComponent(
    billInvitePath(bill),
  )}`;
}

/** Short form of the bill address for human copy (UI affordance only). */
export function shortBill(bill: Address): string {
  return `${bill.slice(0, 6)}…${bill.slice(-4)}`;
}

export const INVITE_SHARE_TITLE = 'Join my Tanda bill';

/**
 * Invite copy — P0.2 discipline (W10_FRONTEND_SPEC §1): market the
 * GUARANTEE, never "split a bill". Deterministic sentence assembly so the
 * golden test pins the exact wire text.
 */
export function buildInviteShareText(
  bill: Address,
  opts: { ownerUsername?: string; usdc?: string } = {},
): string {
  const who = opts.ownerUsername ? `@${opts.ownerUsername} ` : 'A friend ';
  const amt = opts.usdc ? ` (${opts.usdc} USDC in escrow)` : '';
  return (
    `${who}is inviting you to Tanda bill ${shortBill(bill)}${amt}. ` +
    `Funds sit in escrow from day one — when everyone confirms, money moves. ` +
    `Take your seat:`
  );
}
