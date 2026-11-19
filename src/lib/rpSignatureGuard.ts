/**
 * W2-F2 signing-oracle guard (Harley SR-002 kill-pass, finding F2).
 *
 * The /api/rp-signature route used to sign ANY client-supplied `action`
 * string with RP_SIGNING_KEY — an unrestricted signing oracle for the RP
 * identity key. This module pins the server-side enum: only the three
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

export const BILL_RP_ACTIONS = ['bill:confirm', 'bill:execute', 'bill:rotate'] as const;

export type BillRpAction = (typeof BILL_RP_ACTIONS)[number];

const ALLOWED: ReadonlySet<string> = new Set<string>(BILL_RP_ACTIONS);

/** Exact-match membership test. Case-sensitive by design: the signature
 *  message embeds the raw string, so `Bill:Confirm` is a DIFFERENT action
 *  and must not slip through normalization. */
export function isBillRpAction(action: string): action is BillRpAction {
  return ALLOWED.has(action);
}

export type DenyReason =
  | 'offlist_action'
  | 'missing_or_nonstring_action'
  | 'malformed_body';

const LOG_MAX = 80;

/** Make an attacker-supplied value safe for a single-line structured log:
 *  coerce non-strings to a type tag, strip ALL control characters
 *  (newline/CR/tab/esc — log-injection defense), cap length. Never returns
 *  anything containing \n or \r. */
export function sanitizeActionForLog(value: unknown): string {
  if (typeof value !== 'string') {
    return value === null ? 'null' : typeof value === 'object' ? 'object' : String(value);
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '?');
  return cleaned.length > LOG_MAX ? `${cleaned.slice(0, LOG_MAX)}…+${cleaned.length - LOG_MAX}` : cleaned;
}

type Stats = { denied: Record<DenyReason, number>; signed: number };

const stats: Stats = {
  denied: { offlist_action: 0, missing_or_nonstring_action: 0, malformed_body: 0 },
  signed: 0,
};

/** Count + structured-log one rejection. `log` is injectable for tests. */
export function recordRpDeny(
  reason: DenyReason,
  rawAction: unknown,
  log: (line: string) => void = (l) => console.warn(l),
): void {
  stats.denied[reason] += 1;
  const totalDenied = stats.denied.offlist_action
    + stats.denied.missing_or_nonstring_action
    + stats.denied.malformed_body;
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
  stats.denied.offlist_action = 0;
  stats.denied.missing_or_nonstring_action = 0;
  stats.denied.malformed_body = 0;
  stats.signed = 0;
}
