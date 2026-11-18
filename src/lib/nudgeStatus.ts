// P1.1b render lane (t_p11b_nudge_render) — client-side twin of the cadence
// nudge landing states. The off-chain engine (tanda services/nudge_engine.py,
// spec TANDA_P11_CADENCE_NUDGE_SPEC.md §3) pushes N2b/N2c/N3a copy that
// promises a countdown ("Settlement expires in …", "settlement is ready");
// every nudge deep-links to /home. This module derives that same moment from
// the BillSnapshot the probe already fetches — zero new data sources, zero
// contract/RPC reads, pure arithmetic on (snap, nowSec).
//
// Wiring only: the engine decides WHO/WHAT/WHEN and the push lands here;
// this file only RENDERS what the push claimed. Copy mirrors the ratified
// engine strings so the landing matches the notification verbatim where the
// client knows the same facts.
//
// Era scope: factory lineage only (factory-w10 + factory-v2) — those answer
// the V2 settlement 7-tuple with fullyConfirmedAt/MAX_HOLD. Legacy W5 has no
// MAX_HOLD and no fullyConfirmedAt (probe leaves them 0), so it renders null
// rather than a bogus countdown. Terminal states (settled/refunded) render
// null: the existing "Settled on-chain" line owns those moments, and the
// engine goes silent there too (spec §6 cases 1–2).

export type NudgeStatusKind =
  | 'refund-countdown' // initiated, confirmations outstanding, inside MAX_HOLD
  | 'refund-horizon' // past initiatedAt+MAX_HOLD, nobody refunded yet — last call
  | 'execute-countdown' // fully confirmed, settlement window still pending
  | 'executable'; // fully confirmed + window elapsed — settle now

export type NudgeStatus = {
  kind: NudgeStatusKind;
  /** Seconds until the moment fires (null for the already-open `executable`). */
  remainingSec: number | null;
};

/** The fields nudgeStatus reads off BillSnapshot — structural subset so tests
 *  (and other hosts) can pass minimal literals without viem bigint noise. */
export type NudgeSnap = {
  era: string;
  initiatedAt: bigint;
  settledAt: bigint;
  fullyConfirmedAt: bigint;
  refunded: boolean;
  /** SETTLEMENT_WINDOW seconds (1h on factory lineage). */
  window: bigint;
  /** MAX_HOLD seconds (72h on factory lineage). */
  maxHold: bigint;
};

const FACTORY_ERAS: ReadonlySet<string> = new Set(['factory-w10', 'factory-v2']);

export function nudgeStatus(snap: NudgeSnap, nowSec: number): NudgeStatus | null {
  if (!FACTORY_ERAS.has(snap.era)) return null;
  // Terminal first — mirrors engine §6 cases 1–2 (and the app's settled line).
  if (snap.refunded || snap.settledAt > BigInt(0)) return null;
  if (snap.initiatedAt === BigInt(0)) return null; // nothing pending, nothing due

  if (snap.fullyConfirmedAt > BigInt(0)) {
    const execAt = Number(snap.fullyConfirmedAt) + Number(snap.window);
    const remaining = execAt - nowSec;
    return remaining > 0
      ? { kind: 'execute-countdown', remainingSec: remaining }
      : { kind: 'executable', remainingSec: null };
  }

  const deadline = Number(snap.initiatedAt) + Number(snap.maxHold);
  const remaining = deadline - nowSec;
  return remaining > 0
    ? { kind: 'refund-countdown', remainingSec: remaining }
    : { kind: 'refund-horizon', remainingSec: 0 };
}

/** "52h" / "47m" granularity — the same coarse clock the push copy uses. */
export function formatNudgeDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h`;
  return `${Math.max(1, Math.floor(sec / 60))}m`;
}

/** Human label for the chip. `usdc` (already trimmed, e.g. "3.75") is shown
 *  on the last-call states, mirroring the engine's `${usdc}` substitution. */
export function nudgeLabel(st: NudgeStatus, usdc?: string): string {
  const escrow = usdc ? ` ${usdc} USDC` : ' the';
  switch (st.kind) {
    case 'refund-countdown':
      // §3 N2b copy, same sentence the push carried.
      return `Settlement expires in ${formatNudgeDuration(st.remainingSec ?? 0)} — confirm now or escrow auto-refunds`;
    case 'refund-horizon':
      // §3 N2c "last call" moment, still unsurfaced on landing.
      return `Last call: escrow${escrow} returns to the funder on refund — confirm now`;
    case 'execute-countdown':
      return `All seats confirmed — settlement executes in ~${formatNudgeDuration(st.remainingSec ?? 0)}`;
    case 'executable':
      // §3 N3a copy verbatim.
      return 'All seats confirmed — settlement is ready. One tap to open payouts.';
  }
}
