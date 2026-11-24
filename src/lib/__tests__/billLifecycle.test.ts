import { describe, expect, it } from "vitest";
import { lifecycleSteps, nextAction } from "../billLifecycle";

const E = (event: string, extra: object = {}, block = 100) => ({
  event,
  block,
  ...extra,
});

describe("billLifecycle (ui-t1 P1/P2 derivation)", () => {
  it("empty feed: nothing done, CTA is Fund escrow", () => {
    const steps = lifecycleSteps([]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(nextAction([]).cta).toBe("Fund escrow");
  });
  it("funded only: first incomplete is confirm-nudge", () => {
    const ev = [E("EscrowFunded", {}, 37450000)];
    const steps = lifecycleSteps(ev);
    expect(steps[0].done && steps[0].detail).toBe("block 37450000");
    expect(nextAction(ev).cta).toBe("Nudge seats");
  });
  it("counts SeatConfirmed occurrences and SeatPayoutClaimed claims", () => {
    const ev = [
      E("EscrowFunded"),
      E("SeatConfirmed", { seat_id: 0 }),
      E("SeatConfirmed", { seat_id: 1 }),
      E("SettlementInitiated"),
      E("SettlementExecuted"),
      E("SeatPayoutClaimed", { seat_id: 0 }),
    ];
    const steps = lifecycleSteps(ev, 2);
    expect(steps[1].detail).toBe('2 confirmation(s)');
    // partial claim with seatTotal=2: NOT done, CTA stays live
    expect(steps[3].done).toBe(false);
    expect(steps[3].detail).toBe('1 of 2 claim(s)');
    expect(nextAction(ev, 2).cta).toBe('Claim your payout');
    // all claimed: done, no CTA
    const ev2 = [...ev, E('SeatPayoutClaimed', { seat_id: 1 })];
    expect(lifecycleSteps(ev2, 2)[3].done).toBe(true);
    expect(nextAction(ev2, 2).cta).toBe('');
  });
  it("full lifecycle: no CTA, completion note only", () => {
    const ev = [
      E("EscrowFunded"),
      E("SeatConfirmed"),
      E("SettlementExecuted"),
      E("SeatPayoutClaimed"),
    ];
    const a = nextAction(ev);
    expect(a.cta).toBe("");
    expect(a.note).toMatch(/complete/i);
  });
  it("unknown events never mark steps done (no faked ticks)", () => {
    const ev = [E("SomeNewThing")];
    expect(lifecycleSteps(ev).every((s) => !s.done)).toBe(true);
  });
});
