// P0.3 C2 ruling addendum (t_96389deb, Flux 2026-11-17, Option A):
// the badge strip MUST surface "⚠ post-confirm rotation" for any seat with a
// SeatWalletRotated event where seatId ∈ confirmedMask AND rotatedAt >
// fullyConfirmedAt. The blast radius is self-directed, so this is a VISIBILITY
// problem: computed from events alone (an ordering fact), never by contract
// state mutation and never by guessing.
// Amended canonical invariant: "the wallet that confirmed receives payout,
// unless it rotated before confirming OR the execute window elapsed."
//
// Zero chain/DOM deps so the badge tests can pin every clause boundary
// (mirrors the lib/seatVerification.ts discipline).

export type RotationEventLite = {
  /** Seat index from the (indexed) seatId topic. */
  seatId: number;
  /** rotatedAt = the event's block timestamp (unix seconds). */
  blockTimestamp: number;
};

export type RotationFacts = {
  confirmedMask: bigint;
  fullyConfirmedAt: bigint;
};

/**
 * Pure resolver → set of seat ids that rotated AFTER full confirmation.
 * Clause boundaries encoded per ruling wording:
 *  - fullyConfirmedAt <= 0  → no anchor exists → nothing is ever flagged
 *    (a bill that never fully confirmed cannot have a POST-confirm rotation,
 *    even if the mask has stale bits or rotations were emitted).
 *  - rotatedAt STRICTLY > fullyConfirmedAt → flagged; equal timestamps
 *    (same-block rotate + final confirm) are NOT flagged — ">" is strict.
 *  - rotatedAt < fullyConfirmedAt → pre-confirm rotation = legitimate
 *    split-lock branch ("rotated before confirming"), never an anomaly.
 *  - seatId not in confirmedMask → the seat never confirmed, so its
 *    rotation cannot be post-CONFIRM → not flagged.
 *  - multiple rotations per seat: ANY post-confirm event flags the seat.
 * Malformed inputs (non-integer/negative seatId, non-finite timestamp) are
 * skipped defensively — the feed may come from any replica; a bad log must
 * never crash the roster.
 */
export function computePostConfirmRotations(
  events: readonly RotationEventLite[],
  facts: RotationFacts,
): Set<number> {
  const flagged = new Set<number>();
  if (facts.fullyConfirmedAt <= BigInt(0)) return flagged;
  for (const e of events) {
    if (!Number.isInteger(e.seatId) || e.seatId < 0) continue;
    if (!Number.isFinite(e.blockTimestamp)) continue;
    if (BigInt(Math.floor(e.blockTimestamp)) <= facts.fullyConfirmedAt) continue;
    if (((facts.confirmedMask >> BigInt(e.seatId)) & BigInt(1)) !== BigInt(1)) continue;
    flagged.add(e.seatId);
  }
  return flagged;
}
