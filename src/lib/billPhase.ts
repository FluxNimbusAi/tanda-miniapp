// KAIZEN-2 (H2/H3): the phase-honest bill lifecycle vocabulary — ONE canonical
// source for "which phase is this bill in, what is the next legal action, and
// what does the money rule say right now, before we prompt anything".
//
// Lineage: UX-3 issue #186 -> BS-3.1 triage -> ENGINE-64 kaizen scan.
// H2 (Sablier lineage): state the money rule BEFORE the action — cancel-early
// = full return, mid-term = split per terms, expiry = per contract.
// H3 (InvoBase/SubBase lineage): explicit lifecycle state machine, one noun per
// phase, and grace semantics: failure/timeout is not silent cancellation — the
// refund DOOR opens. Grep of the services lane proves nothing auto-runs:
// refund and execute are permissionless doors opening at
// initiatedAt+MAX_HOLD / fullyConfirmedAt+WINDOW. Old chip copy promised
// "escrow auto-refunds" / "settlement executes in ~45m" — contract law says
// callable-then, so copy may not say automatic. Absorbs card 7: the honest
// deadline surface (1h window / 72h hold) is displayed here, paired with
// refund-in-full human math, never a fake tick.
//
// Canonical machine (factory lineage, V2 settlement 7-tuple):
//   draft -> funded -> initiated -> window -> executable -> settled | refunded
// Legacy W5 answers the probe with fullyConfirmedAt/MAX_HOLD = 0, so timers
// render null (no invented deadlines). Pure arithmetic on (snap, nowSec) —
// zero MiniKit/viem/Date reads, same lane shape as nudgeStatus.

export type BillPhase =
  | 'draft'
  | 'funded'
  | 'initiated'
  | 'window'
  | 'executable'
  | 'settled'
  | 'refunded';

/** Forward (non-terminal) spine of the machine, in order (H3). */
export const PHASE_ORDER: readonly BillPhase[] = [
  'draft',
  'funded',
  'initiated',
  'window',
  'executable',
];

/** Terminal phases — reached by on-chain events only. */
export const TERMINAL_PHASES: readonly BillPhase[] = ['settled', 'refunded'];

/** Structural subset of BillSnapshot — the fields the phase machine reads
 *  (superset of NudgeSnap; escrow is optional and only splits draft/funded). */
export type PhaseSnap = {
  era: string;
  initiatedAt: bigint;
  settledAt: bigint;
  fullyConfirmedAt: bigint;
  refunded: boolean;
  /** SETTLEMENT_WINDOW seconds (1h on factory lineage). */
  window: bigint;
  /** MAX_HOLD seconds (72h on factory lineage). */
  maxHold: bigint;
  /** Escrow units held by the contract. 0/omitted = nothing funded yet. */
  escrow?: bigint;
};

export type BillPhaseInfo = {
  phase: BillPhase;
  /** Canonical chip noun. One noun per phase (H3): seats SIGN, userOps MINE,
   *  settlement EXECUTES — the word "confirmed" is retired from derived copy
   *  because one screen used it in three distinct meanings. */
  label: string;
  /** H2 money rule, stated before any action prompt. `usdc` (already trimmed,
   *  e.g. "12.5") names the actual recoverable amount when the app knows it. */
  moneyRule: string;
  /** The single next legal action to surface ('' = nothing to prompt). */
  nextLegalAction: string;
  /** Seconds until this phase's honest deadline (refund door open / window
   *  close). null = no deadline to display; never a fake tick. */
  remainingSec: number | null;
  /** True while initiated, unconfirmed-out, and past initiatedAt+MAX_HOLD:
   *  the refund door is open (grace semantics — nobody auto-cancelled). */
  refundDoorOpen: boolean;
};

const FACTORY_ERAS: ReadonlySet<string> = new Set(['factory-w10', 'factory-v2']);
const ZERO = BigInt(0);

/** "52h" / "47m" coarse clock — canonical home moved here so phase copy and
 *  nudge copy share one formatter (nudgeStatus re-exports for compat). */
export function formatNudgeDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h`;
  return `${Math.max(1, Math.floor(sec / 60))}m`;
}

/** The phase resolver: pure function of (snap, nowSec) — indexer snapshot in,
 *  honest lifecycle out. Terminal events win first (engine spec §6 cases 1–2:
 *  settled/refunded are silent moments owned by the on-chain line). */
export function billPhase(
  snap: PhaseSnap,
  nowSec: number,
  usdc?: string,
): BillPhaseInfo {
  const esc = usdc ? `${usdc} USDC` : 'the escrow';
  const factory = FACTORY_ERAS.has(snap.era);

  // Terminals first — reached only by on-chain events, never by countdown.
  if (snap.refunded) {
    return {
      phase: 'refunded',
      label: 'Refunded',
      moneyRule: `${cap(esc)} went back to the funder in full — the on-chain event is the receipt.`,
      nextLegalAction: '',
      remainingSec: null,
      refundDoorOpen: false,
    };
  }
  if (snap.settledAt > ZERO) {
    return {
      phase: 'settled',
      label: 'Executed',
      moneyRule: `Split per the signed vector — every payout pulls its own share; the on-chain event is the receipt.`,
      nextLegalAction: '',
      remainingSec: null,
      refundDoorOpen: false,
    };
  }

  // Pre-initiation: draft vs funded is purely whether escrow holds value.
  if (snap.initiatedAt === ZERO) {
    if (snap.escrow !== undefined && snap.escrow > ZERO) {
      return {
        phase: 'funded',
        label: 'Funded',
        moneyRule: `${cap(esc)} is locked in escrow — it moves only per the settlement terms, never by app action.`,
        nextLegalAction: 'Initiate settlement',
        remainingSec: null,
        refundDoorOpen: false,
      };
    }
    return {
      phase: 'draft',
      label: 'Draft',
      moneyRule: 'Nothing has moved yet — funding parks the USDC in escrow before anyone works.',
      nextLegalAction: 'Fund escrow',
      remainingSec: null,
      refundDoorOpen: false,
    };
  }

  // Initiated, every seat signed, settlement window pending or elapsed.
  if (snap.fullyConfirmedAt > ZERO && factory) {
    const execAt = Number(snap.fullyConfirmedAt) + Number(snap.window);
    const remaining = execAt - nowSec;
    if (remaining > 0) {
      return {
        phase: 'window',
        label: 'All signed — window',
        moneyRule: `The vector is locked: splits stay per terms — mid-term nothing changes, ${esc} is committed.`,
        nextLegalAction: `Execution unlocks in ~${formatNudgeDuration(remaining)} — then anyone can settle`,
        remainingSec: remaining,
        refundDoorOpen: false,
      };
    }
    return {
      phase: 'executable',
      label: 'Executable',
      moneyRule: `Settlement is unlocked — anyone can execute; payouts split per the signed vector.`,
      nextLegalAction: 'Settle now (permissionless)',
      remainingSec: null,
      refundDoorOpen: false,
    };
  }

  // Initiated, seats still signing. Refund door arithmetic needs MAX_HOLD —
  // legacy W5 answers 0, so it gets no deadline display (never a fake tick).
  if (!factory) {
    return {
      phase: 'initiated',
      label: 'Awaiting signatures',
      moneyRule: `Cancel-early returns ${esc} in full — refund terms per contract: nothing moves unless someone calls it.`,
      nextLegalAction: 'Confirm my seat',
      remainingSec: null,
      refundDoorOpen: false,
    };
  }
  const doorAt = Number(snap.initiatedAt) + Number(snap.maxHold);
  const remaining = doorAt - nowSec;
  if (remaining > 0) {
    return {
      phase: 'initiated',
      label: 'Awaiting signatures',
      moneyRule: `Refund door opens in ${formatNudgeDuration(remaining)} — until then cancel-early returns ${esc} in full.`,
      nextLegalAction: 'Confirm my seat',
      remainingSec: remaining,
      refundDoorOpen: false,
    };
  }
  return {
    phase: 'initiated',
    label: 'Refund door open',
    moneyRule: `Last call: the refund door is open — ${esc} returns to the funder in full, and anyone can call the refund.`,
    nextLegalAction: 'Refund settlement (permissionless)',
    remainingSec: 0,
    refundDoorOpen: true,
  };
}

/** Cheap sentence starter. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
