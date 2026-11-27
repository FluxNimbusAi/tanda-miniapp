import { describe, expect, it } from 'vitest';
import { synthesizeFeed } from '../chainBill';

const S = (over = {}) => ({
  id: 0, total_amount: '20000', payouts: ['10000', '10000'],
  settled_at: 1795303266, initiated_at: 1795299638,
  expected_mask: '3', confirmed_mask: '3', claimed_mask: '3', refunded: false,
  ...over,
});

describe('synthesizeFeed implied-completion rule (Flux audit item 1 / Xixi 7.4)', () => {
  it('drained escrow + settled bill => EscrowFunded STILL emitted (CTA defect root)', () => {
    const ev = synthesizeFeed(BigInt(0), [S()], 37495073);
    expect(ev.map((e) => e.event)).toEqual([
      'EscrowFunded', 'SettlementInitiated', 'SeatConfirmed', 'SeatConfirmed',
      'SettlementExecuted', 'SeatPayoutClaimed', 'SeatPayoutClaimed',
    ]);
    // funded amount falls back to the settlement total - a bound, not a lie
    expect(ev[0].amount).toBe('20000');
  });
  it('live escrow => funded row carries the balance itself', () => {
    const ev = synthesizeFeed(BigInt(5000), [], 100);
    expect(ev).toEqual([{ event: 'EscrowFunded', block: 100, amount: '5000' }]);
  });
  it('zero balance AND zero settlements => nothing synthesized (no faked ticks)', () => {
    expect(synthesizeFeed(BigInt(0), [], 100)).toEqual([]);
  });
  it("fast-twin variant (claimed_mask null): executed but claims UNKNOWABLE, never faked", () => {
    const ev = synthesizeFeed(BigInt(0), [S({ claimed_mask: null })], 100);
    expect(ev.some((e) => e.event === "SeatPayoutClaimed")).toBe(false);
    expect(ev.some((e) => e.event === "SettlementExecuted")).toBe(true);
    expect(ev.some((e) => e.event === "EscrowFunded")).toBe(true);
  });
  it('refunded settlement surfaces the refund row', () => {
    const ev = synthesizeFeed(BigInt(0), [S({ settled_at: 0, claimed_mask: '0', refunded: true })], 7);
    expect(ev.some((e) => e.event === 'SettlementRefunded')).toBe(true);
    expect(ev.some((e) => e.event === 'SeatPayoutClaimed')).toBe(false);
  });
});
