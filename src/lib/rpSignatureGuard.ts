/**
 * W2-F2 signing-oracle guard (Harley SR-002 kill-pass, finding F2).
 *
 * The /api/rp-signature route used to sign ANY client-supplied `action`
 * string with RP_SIGNING_KEY — an unrestricted signing oracle for the RP
 * identity key. This module pins the server-side enum: only the four
 * TandaBill protocol actions are signable, everything else is rejected
 * with a 4xx, a structured log line, and a per-reason counter.
 *
 * Action strings are bound into the RP signature message by idkit
 * (computeRpSignatureMessage hashes `action` into the signed payload), so
 * an exact-match enum here is the whole gate — no client payload is ever
 * trusted beyond these literals (verify-proof docs, World policy #10).
 *
 * Follow-ups live in their own cards: env-only RP_ID/key = SR-002-A3,
 * origin/CSRF checks = SR-002-A5, rate limiting = SR-002-A5.
 */

// ACTION-FLIP (Flux ruling 19:0x, live portal readback t_31f09cee: action_v4_
// (PORTAL-MIGRATE 2026-11-24: action hash + rp below belong to the DELETED app;
// the portal name joins the frozen enum so BOTH wire actions are accepted by
// default, with no env needed. 'bill:confirm' is KEPT (transition window,
// dual-accept) so legacy signed artifacts + legacy-env deployments still verify.
export const BILL_RP_ACTIONS = ['bill:confirm', 'bill:execute', 'bill:rotate', 'tanda_bill_settlement'] as const;

export type BillRpAction = (typeof BILL_RP_ACTIONS)[number];

/** Default wire action for the bill-confirm leg. ACTION-FLIP (Flux ruling
 *  19:0x + live MCP readback t_31f09cee): the live portal record CONFIRMS
 *  `tanda_bill_settlement` (action_v4_62c3d88d2282da0810928cbafe0a88ef,
 *  rp_4fbd445435612f67), so the default resolution now carries the portal
 *  NOTE 2026-11-26 ROTATION: action NAME unchanged; ids re-issued by World -
 *  staging action_v4_590146b1a650eebd839820b8449d3546, production
 *  action_v4_d9aa3f475a9ccbd8f18aed936380f924 (Flux create_world_id_action).
 *  Code resolves by NAME only; no id literals exist in this repo (verified
 *  by grep 2026-11-26), so rotation required zero logic change. (SR-F1KP)
 *  name. The signed message and the proof must ride the SAME string
 *  (SR-F1KP) — clients get it from SEAT_JOIN_ACTION, which resolves through
 *  this default. Legacy `bill:confirm` remains ACCEPTED in BILL_RP_ACTIONS
 *  (dual-accept, transition window, no removal). Operators pin either name
 *  via env (server: TANDA_CONFIRM_ACTION, client bundle:
 *  NEXT_PUBLIC_CONFIRM_ACTION, legacy alias NEXT_PUBLIC_TANDA_CONFIRM_ACTION).
 *  Flag + escalation + flip record: docs/adr/ADR-0010. */
export const CONFIRM_ACTION_DEFAULT: BillRpAction = 'tanda_bill_settlement';

/** Pure override resolution: trimmed non-empty value wins, else default. */
export function resolveConfirmAction(override: string | undefined): string {
  const v = override?.trim();
  return v !== undefined && v.length > 0 ? v : CONFIRM_ACTION_DEFAULT;
}

/** Server-resolved confirm action name (deployment env, module-init). */
export const TANDA_CONFIRM_ACTION: string = resolveConfirmAction(
  process.env.TANDA_CONFIRM_ACTION,
);

/** Gate = frozen enum PLUS the single operator-pinned confirm name. Under the
 *  default this is exactly BILL_RP_ACTIONS; an override adds exactly one
 *  string and never widens the oracle to arbitrary verbs. */
const ALLOWED: ReadonlySet<string> = new Set<string>([
  ...BILL_RP_ACTIONS,
  TANDA_CONFIRM_ACTION,
]);

/** Exact-match membership test. Case-sensitive by design: the signature
 *  message embeds the raw string, so `Bill:Confirm` is a DIFFERENT action
 *  and must not slip through normalization. */
export function isBillRpAction(action: string): action is BillRpAction {
  return ALLOWED.has(action);
}

export type DenyReason =
  | 'offlist_action'
  | 'missing_or_nonstring_action'
  | 'malformed_body'
  // C1 wave (PR #54): identity + rate-limit denials recorded by the route
  | 'unauthenticated'
  | 'rate_limited';

const LOG_MAX = 80;

/** Make an attacker-supplied value safe for a single-line structured log:
 *  coerce non-strings to a type tag, strip ALL control characters
 *  (newline/CR/tab/esc — log-injection defense), cap length. Never returns
 *  anything containing \n or \r. */
export function sanitizeActionForLog(value: unknown): string {
  if (typeof value !== 'string') {
    return value === null ? 'null' : typeof value === 'object' ? 'object' : String(value);
  }
  // Stripping control chars is the function's purpose; the rule would flag it.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '?');
  return cleaned.length > LOG_MAX ? `${cleaned.slice(0, LOG_MAX)}…+${cleaned.length - LOG_MAX}` : cleaned;
}

type Stats = { denied: Record<DenyReason, number>; signed: number };

const stats: Stats = {
  denied: { offlist_action: 0, missing_or_nonstring_action: 0, malformed_body: 0, unauthenticated: 0, rate_limited: 0 },
  signed: 0,
};

/** Count + structured-log one rejection. `log` is injectable for tests. */
export function recordRpDeny(
  reason: DenyReason,
  rawAction: unknown,
  log: (line: string) => void = (l) => console.warn(l),
): void {
  stats.denied[reason] += 1;
  // Key-agnostic total: adding a DenyReason member can no longer desync the counter.
  const totalDenied = Object.values(stats.denied).reduce((a, b) => a + b, 0);
  log(
    `[rp-signature] DENY reason=${reason} action="${sanitizeActionForLog(rawAction)}" ` +
      `denied_total=${totalDenied}`,
  );
}

export function recordRpSign(): void {
  stats.signed += 1;
}

/** Snapshot for tests / future metrics endpoint (no live-socket exposure
 *  in this PR — read-only helper, reversible). */
export function getRpDenyStats(): Stats {
  return { denied: { ...stats.denied }, signed: stats.signed };
}

export function resetRpDenyStats(): void {
  for (const k of Object.keys(stats.denied) as DenyReason[]) stats.denied[k] = 0;
  stats.signed = 0;
}

// C1 limiter (moved out of /api/rp-signature route module, PR #54 CI fix):
// in-memory sliding window per IP, dev-lane parity with notify's dedupe-map
// pattern. Edge-instance reset on cold start is acceptable while the auth
// gate is the real wall; DB-backed counters at scale = logged backlog.
// Lives here because Next route modules may only export handlers/config —
// an extra export breaks `next build` type validation (Vercel fail).
const WINDOW_MS = 60_000;
const LIMIT = 20;
const hits = new Map<string, number[]>();

/** Test seam: clears sliding-window state between suites. Not for runtime use. */
export function resetRpRateLimitForTesting(): void {
  hits.clear();
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > LIMIT;
}
