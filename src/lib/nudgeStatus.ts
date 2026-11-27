// P1.1b render lane (t_p11b_nudge_render) — client-side twin of the cadence
// nudge landing states. The off-chain engine (tanda services/nudge_engine.py,
// spec TANDA_P11_CADENCE_NUDGE_SPEC.md §3) pushes N2b/N2c/N3a copy that
// promises a countdown ("Settlement expires in …", "settlement is ready");
// every nudge deep-links to /home. This module derives that same moment from
// the BillSnapshot the probe already fetches — zero new data sources, zero
// contract/RPC reads, pure arithmetic on (snap, nowSec).
//
// KAIZEN-2 (H2/H3): phase honesty correction. The engine copy promised an
// automatic outcome ("escrow auto-refunds", "settlement executes in ~45m"),
// but the services lane has ZERO auto-callers — refund/execute are
// permissionless doors that OPEN at initiatedAt+MAX_HOLD /
// fullyConfirmedAt+WINDOW. Copy now says door-language and states the money
// rule before the action (refund-in-full / split-per-terms), derived from the
// canonical billPhase machine so the chip and the lifecycle share one
// vocabulary. The engine-side mirror (nudge_engine.py push strings) rides a
// SEPARATE tanda branch after KAIZEN-3 merges — this repo no longer mirrors
// the old strings verbatim on purpose.
//
// Era scope: factory lineage only (factory-w10 + factory-v2) — those answer
// the V2 settlement 7-tuple with fullyConfirmedAt/MAX_HOLD. Legacy W5 has no
// MAX_HOLD and no fullyConfirmedAt (probe leaves them 0), so it renders null
// rather than a bogus countdown. Terminal states (settled/refunded) render
// null: the existing "Settled on-chain" line owns those moments, and the
// engine goes silent there too (spec §6 cases 1–2).

import { billPhase, formatNudgeDuration, type PhaseSnap } from './billPhase';

export { formatNudgeDuration } from './billPhase';
export type { PhaseSnap } from './billPhase';

export type NudgeStatusKind =
  | 'refund-countdown' // initiated, signatures outstanding, inside MAX_HOLD
  | 'refund-horizon' // past initiatedAt+MAX_HOLD, nobody refunded yet — last call
  | 'execute-countdown' // all seats signed, settlement window still pending
  | 'executable'; // all seats signed + window elapsed — settle now

export type NudgeStatus = {
  kind: NudgeStatusKind;
  /** Seconds until the moment fires (null for the already-open `executable`). */
  remainingSec: number | null;
};

/** The fields nudgeStatus reads off BillSnapshot — structural subset so tests
 *  (and other hosts) can pass minimal literals without viem bigint noise.
 *  Alias of billPhase's PhaseSnap: one machine, one input shape. */
export type NudgeSnap = PhaseSnap;

const FACTORY_ERAS: ReadonlySet<string> = new Set(['factory-w10', 'factory-v2']);

export function nudgeStatus(snap: NudgeSnap, nowSec: number): NudgeStatus | null {
  if (!FACTORY_ERAS.has(snap.era)) return null;
  // Single source of truth for the arithmetic + honesty (billPhase).
  const info = billPhase(snap, nowSec);
  switch (info.phase) {
    case 'initiated':
      return info.refundDoorOpen
        ? { kind: 'refund-horizon', remainingSec: 0 }
        : { kind: 'refund-countdown', remainingSec: info.remainingSec ?? 0 };
    case 'window':
      return { kind: 'execute-countdown', remainingSec: info.remainingSec ?? 0 };
    case 'executable':
      return { kind: 'executable', remainingSec: null };
    default:
      // draft/funded (nothing pending), settled/refunded (terminal silence,
      // engine §6 cases 1–2 — the on-chain status line owns those moments).
      return null;
  }
}

/** Human label for the chip. `usdc` (already trimmed, e.g. "3.75") is shown
 *  on the refund-door states, mirroring the engine's `${usdc}` substitution.
 *  KAIZEN-2 law: door language, never "auto"; money rule before the prompt;
 *  seats SIGN (the word "confirmed" left chip copy with the vocab collision). */
export function nudgeLabel(st: NudgeStatus, usdc?: string): string {
  const escrow = usdc ? ` ${usdc} USDC` : ' the escrow';
  switch (st.kind) {
    case 'refund-countdown':
      // Door not open yet: cancel-early is a full return; nothing moves by itself.
      return `Confirm now — cancel-early returns${escrow} in full until the refund door opens in ${formatNudgeDuration(st.remainingSec ?? 0)}`;
    case 'refund-horizon':
      // Door is OPEN: permissive, not automatic. Anyone may call the refund.
      return `Last call: the refund door is open —${escrow} returns to the funder in full and anyone can call it. Seats can still settle.`;
    case 'execute-countdown':
      // Seats SIGN (H3 vocab); execution unlocks, never "executes by itself".
      return `All seats signed — settlement unlocks in ~${formatNudgeDuration(st.remainingSec ?? 0)}, then anyone can execute`;
    case 'executable':
      return 'Settlement is unlocked — one tap executes. Payouts split per the signed vector.';
  }
}
