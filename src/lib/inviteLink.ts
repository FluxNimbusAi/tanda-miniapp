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
//
// KAIZEN-1 (t_2eefc765, finding H1): a bare-address link forced the invitee
// to re-guess the deal. The builder now carries the bill CONTEXT in the
// path's own query - ?amount=<usdc>&who=%40<handle>&redirect=<internal
// path> - so the landing page can attribute "@walters invited you (12.5
// USDC)" before any indexer round-trip. Params ride ONE encoding layer deep
// (encodeURIComponent of the whole path) - exactly the World App
// Quick-Action path contract. Omitting opts yields the byte-identical legacy
// path, so every W2.5-4 golden stays pinned. The READ lane below is
// fail-closed: anyone can craft such a link, so nothing parsed here is
// trusted beyond sanitized display, and a redirect is NEVER auto-followed -
// it only serves as a same-origin internal link target.
import { getAddress, isAddress, type Address } from "viem";

/** World developer-portal app ids are `app_` + opaque alphanumerics
 *  (canonical anchor: PORTAL_APP_ID via portalAnchors; m4_hosting E5 era).
 *  Bounded regex guards a malformed env from ever reaching a share sheet. */
export const WORLD_APP_ID_RE = /^app_[A-Za-z0-9]{8,64}$/;

/** Share-link context params (KAIZEN-1 / H1). All optional; invalid values
 *  are DROPPED, never thrown - a bad amount must not kill the whole invite. */
export type InviteParams = {
  /** decimal USDC, wire-checked by AMOUNT_RE */
  amount?: string;
  /** inviter handle, with or without leading @ */
  who?: string;
  /** in-app return path; must pass safeRedirect */
  redirect?: string;
};

/** USDC shape gate: bounded plain decimal - no exponent, no sign, no
 *  separators. Display-only context, never an authoritative amount. */
export const AMOUNT_RE = /^\d{1,12}(\.\d{1,6})?$/;

/** World ID handle charset, bounded. Anything else fails closed to null. */
const WHO_RE = /^[A-Za-z0-9_\-.]{1,32}$/;

/** Decode + strip an invite `who` value to a display handle, fail-closed.
 *  Tolerates both wire layers: percent form '%40walters' (World App hands the
 *  path pre-decoded ONCE; the query's own encoding may survive) and the plain
 *  '@walters' form Next already decoded. Empty, '@' alone, junk, oversized,
 *  or non-string -> null. */
export function passWho(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* undecodable percent text - judge the verbatim value instead */
  }
  if (s.startsWith("@")) s = s.slice(1);
  return WHO_RE.test(s) ? s : null;
}

/** Fail-closed validator for a redirect param. Only a same-origin INTERNAL
 *  path is allowed: leading '/', never '//' (protocol-relative), no
 *  scheme/backslash/control whitespace, bounded length. Type predicate so
 *  callers narrow string|string[]|undefined in one pass. */
export function safeRedirect(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    raw.length <= 200 &&
    /^\/(?!\/)[A-Za-z0-9\-._~\/?=&%#@]*$/.test(raw)
  );
}

/** Canonical in-mini-app path for a bill. EIP-55 checksum form -> the SAME
 *  url from any pasted casing (deterministic, golden-testable). */
/** KAIZEN-1: with `opts`, valid context params append as a query in FIXED
 *  order (amount, who, redirect); invalid ones are silently dropped. */
export function billInvitePath(bill: Address, opts?: InviteParams): string {
  if (!isAddress(bill))
    throw new RangeError(`invite: not a valid bill address: ${bill}`);
  const base = `/bill/${getAddress(bill)}`;
  if (!opts) return base;
  const q: string[] = [];
  if (typeof opts.amount === "string" && AMOUNT_RE.test(opts.amount))
    q.push(`amount=${opts.amount}`);
  const who = opts.who === undefined ? null : passWho(opts.who);
  if (who !== null) q.push(`who=${encodeURIComponent(`@${who}`)}`);
  if (typeof opts.redirect === "string" && safeRedirect(opts.redirect))
    q.push(`redirect=${encodeURIComponent(opts.redirect)}`);
  return q.length > 0 ? `${base}?${q.join("&")}` : base;
}

/** Shareable universal invite link for one bill. */
export function buildBillInviteUrl(
  bill: Address,
  appId: string,
  opts?: InviteParams,
): string {
  if (!WORLD_APP_ID_RE.test(appId))
    throw new RangeError(`invite: invalid World app_id: ${appId}`);
  return `https://world.org/mini-app?app_id=${appId}&path=${encodeURIComponent(
    billInvitePath(bill, opts),
  )}`;
}

/** Landing read lane (KAIZEN-1 / H1): Next searchParams-shaped input
 *  (string | string[] | undefined per key) -> sanitized context. Arrays
 *  (?who=a&who=b) fail closed; only a scalar is ever accepted. */
export function parseInviteParams(sp: {
  [k: string]: string | string[] | undefined;
}): { who: string | null; amount: string | null; redirect: string | null } {
  const amount = sp.amount;
  const redirect = sp.redirect;
  return {
    who: passWho(sp.who),
    amount:
      typeof amount === "string" && AMOUNT_RE.test(amount) ? amount : null,
    redirect: safeRedirect(redirect) ? redirect : null,
  };
}

/** Short form of the bill address for human copy (UI affordance only). */
export function shortBill(bill: Address): string {
  return `${bill.slice(0, 6)}…${bill.slice(-4)}`;
}

export const INVITE_SHARE_TITLE = "Join my Tanda bill";

/**
 * Invite copy — P0.2 discipline (W10_FRONTEND_SPEC §1): market the
 * GUARANTEE, never "split a bill". Deterministic sentence assembly so the
 * golden test pins the exact wire text.
 */
export function buildInviteShareText(
  bill: Address,
  opts: { ownerUsername?: string; usdc?: string } = {},
): string {
  const who = opts.ownerUsername ? `@${opts.ownerUsername} ` : "A friend ";
  const amt = opts.usdc ? ` (${opts.usdc} USDC in escrow)` : "";
  return (
    `${who}is inviting you to Tanda bill ${shortBill(bill)}${amt}. ` +
    `Funds sit in escrow from day one — when everyone confirms, money moves. ` +
    `Take your seat:`
  );
}
