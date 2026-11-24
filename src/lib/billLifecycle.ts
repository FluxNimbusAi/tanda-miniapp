/**
 * ui-t1 P1/P2 derivation (t_ux3 lane): the bill lifecycle is a PURE function
 * of indexer event rows - no client-side guessing, no chain reads (W8 law).
 * Steps and their evidence events (V2 canonical names from bill_index feed):
 *   funded   <- EscrowFunded
 *   confirmed<- SeatConfirmed (count seats)
 *   executed <- SettlementExecuted
 *   claimed  <- SeatPayoutClaimed (count payouts)
 * Anything the feed lacks renders as "not yet", never as a faked tick.
 */
export type FeedEvent = {
  event: string;
  block: number | string;
  seat_id?: number | string | null;
  amount?: string | number | null;
  tx_hash?: string | null;
};

export type LifecycleStep = {
  key: "funded" | "confirmed" | "executed" | "claimed";
  label: string;
  done: boolean;
  detail?: string;
};

export function lifecycleSteps(events: FeedEvent[], seatTotal = 0): LifecycleStep[] {
  const has = (n: string) => events.filter((e) => e.event === n);
  const funded = has("EscrowFunded");
  const confirmed = has("SeatConfirmed");
  const executed = has("SettlementExecuted");
  const claimed = has("SeatPayoutClaimed");
  return [
    {
      key: "funded",
      label: "Escrow funded",
      done: funded.length > 0,
      detail: funded.length ? `block ${String(funded[0].block)}` : undefined,
    },
    {
      key: "confirmed",
      label: "Seats confirmed",
      done: confirmed.length > 0,
      detail: confirmed.length
        ? `${confirmed.length} confirmation(s)`
        : undefined,
    },
    {
      key: "executed",
      label: "Settlement executed",
      done: executed.length > 0,
      detail: executed.length
        ? `block ${String(executed[0].block)}`
        : undefined,
    },
    {
      key: "claimed",
      label: "Payouts claimed",
      // All-seats semantics: a partial claim must NOT mark the step done -
      // the CTA stays live for the seats that have not pulled yet (found by
      // the ui-t1 golden: 1-of-2 claims must still read "Claim your payout").
      done: claimed.length > 0 && (seatTotal < 1 || claimed.length >= seatTotal),
      detail: claimed.length
        ? seatTotal > 0
          ? `${claimed.length} of ${seatTotal} claim(s)`
          : `${claimed.length} claim(s)`
        : undefined,
    },
  ];
}

/**
 * ui-t1 P1: the next-action CTA derived from the same feed - exactly one
 * actionable step, first incomplete wins. Read-model only; the actual
 * signing lanes live in TandaBill and obey expectedMask supremacy.
 */
export function nextAction(events: FeedEvent[], seatTotal = 0): { cta: string; note: string } {
  const steps = lifecycleSteps(events, seatTotal);
  const first = steps.find((s) => !s.done);
  switch (first?.key) {
    case "funded":
      return {
        cta: "Fund escrow",
        note: "USDC parks in the contract before anyone works.",
      };
    case "confirmed":
      return {
        cta: "Nudge seats",
        note: "Every seat confirms the vector before funds can move.",
      };
    case "executed":
      return {
        cta: "Execute settlement",
        note: "Owner releases payouts once all seats are in.",
      };
    case "claimed":
      return {
        cta: "Claim your payout",
        note: "Pull-claim: the on-chain event is your receipt.",
      };
    default:
      return { cta: "", note: "Lifecycle complete - every payout claimed." };
  }
}
