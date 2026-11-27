// KAIZEN-5 goldens (t_86b44100): the sweep plan must be deterministic, the
// H4 copy exact-string, and the H5 per-bill selection stable. Calldata is
// re-encoded INDEPENDENTLY with viem inside the test (never by importing the
// SUT's own encoder) so the golden proves the callBill(claimSettlement)
// wrapper shape, not just self-consistency.
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, type Abi } from 'viem';
import BillABI from '@/abi/TandaBillV2.json';
import FactoryABI from '@/abi/TandaBillFactory.json';

import {
  accrualCopy,
  billKey,
  buildSweepPlan,
  formatUSDC,
  groupByBill,
  selectedRows,
  sumUnclaimed,
  sweepCtaCopy,
  toggleBillSelection,
  type ClaimRow,
} from '@/lib/claimSweep';
import type { Address } from 'viem';

const FACTORY = '0xFaC0000000000000000000000000000000000001';
const BILL_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BILL_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const row = (
  bill: Address,
  settlementId: number,
  unclaimed: bigint,
  settledAt: number | null = 1795106234,
): ClaimRow => ({ bill, settlementId, unclaimedUnits: unclaimed, settledAt });

describe('buildSweepPlan — deterministic batched callBill wrappers', () => {
  const entries = [
    row(BILL_B, 0, BigInt(20000)),
    row(BILL_A, 3, BigInt(5000)),
    row(BILL_A, 1, BigInt(0)), // zero pool: nothing to pull, dropped
    row(BILL_A, 2, BigInt(10000)),
  ];

  it('sorts by (bill, settlementId), filters zero pools, targets the factory only', () => {
    const plan = buildSweepPlan(entries, FACTORY);
    expect(plan.map((p) => p.label)).toEqual([
      'claimSettlement',
      'claimSettlement',
      'claimSettlement',
    ]);
    expect(plan.every((p) => p.to === FACTORY)).toBe(true);
    // expected order: A#2, A#3, B#0 (A#1 zero-pool gone)
    const inner = (bill: Address, id: number) =>
      encodeFunctionData({
        abi: BillABI as unknown as Abi,
        functionName: 'claimSettlement',
        args: [BigInt(id)],
      });
    const expectData = (bill: Address, id: number) =>
      encodeFunctionData({
        abi: FactoryABI as unknown as Abi,
        functionName: 'callBill',
        args: [bill, inner(bill, id)],
      });
    expect(plan[0].data).toBe(expectData(BILL_A, 2));
    expect(plan[1].data).toBe(expectData(BILL_A, 3));
    expect(plan[2].data).toBe(expectData(BILL_B, 0));
  });

  it('is input-order independent (same multiset -> byte-identical plan)', () => {
    const shuffled = [entries[2], entries[0], entries[3], entries[1]];
    expect(buildSweepPlan(shuffled, FACTORY)).toEqual(
      buildSweepPlan(entries, FACTORY),
    );
  });

  it('all-zero / empty input -> empty plan (never an empty userOp invite)', () => {
    expect(buildSweepPlan([], FACTORY)).toEqual([]);
    expect(
      buildSweepPlan([row(BILL_A, 0, BigInt(0))], FACTORY),
    ).toEqual([]);
  });
});

describe('formatUSDC — pure bigint 6-decimal rendering, no float', () => {
  it.each([
    [BigInt(0), '0'],
    [BigInt(1), '0.000001'],
    [BigInt(20000), '0.02'],
    [BigInt(1000000), '1'],
    [BigInt(1500000), '1.5'],
    [BigInt(1000001), '1.000001'],
    [-BigInt(20000), '-0.02'],
  ] as const)('%s -> %s', (units, want) => {
    expect(formatUSDC(units)).toBe(want);
  });
});

describe('accrualCopy — H4 pileup framing (exact strings)', () => {
  it('zero state is all-clear', () => {
    expect(accrualCopy(0, BigInt(0))).toBe(
      'Nothing waiting — every settled bill is claimed.',
    );
  });
  it('one bill is a single-claim nudge, not a pileup', () => {
    expect(accrualCopy(1, BigInt(20000))).toBe(
      '0.02 USDC is still waiting in 1 settled bill. One tap to pull it.',
    );
  });
  it('many bills is the pileup call-to-action', () => {
    expect(accrualCopy(3, BigInt(1500000))).toBe(
      '1.5 USDC is piling up across 3 settled bills. Sweep them all in one signature.',
    );
  });
});

describe('sweepCtaCopy — selection-aware CTA', () => {
  expect(sweepCtaCopy(0, BigInt(0))).toBe('Select a bill to sweep');
  it('singular/plural and pool figure', () => {
    expect(sweepCtaCopy(1, BigInt(20000))).toBe('Sweep 0.02 USDC from 1 bill');
    expect(sweepCtaCopy(2, BigInt(1500000))).toBe('Sweep 1.5 USDC from 2 bills');
  });
});

describe('H5 per-bill selection semantics', () => {
  const rows = [
    row(BILL_B, 0, BigInt(20000)),
    row(BILL_A, 2, BigInt(10000)),
    row(BILL_A, 3, BigInt(5000)),
  ];

  it('billKey lowercases', () => {
    expect(billKey(BILL_A.toUpperCase() as Address)).toBe(BILL_A);
  });

  it('toggle adds, removes, normalizes case, keeps keys sorted', () => {
    let sel = toggleBillSelection([], BILL_B.toUpperCase() as string);
    expect(sel).toEqual([BILL_B]);
    sel = toggleBillSelection(sel, BILL_A);
    expect(sel).toEqual([BILL_A, BILL_B]);
    sel = toggleBillSelection(sel, BILL_A);
    expect(sel).toEqual([BILL_B]);
  });

  it('selectedRows filters by bill (all settlements move together) in sweep order', () => {
    const picked = selectedRows(rows, [BILL_A]);
    expect(picked.map((r) => [r.bill, r.settlementId])).toEqual([
      [BILL_A, 2],
      [BILL_A, 3],
    ]);
    // mixed-case selection key still matches
    expect(selectedRows(rows, [BILL_A.toUpperCase()])).toHaveLength(2);
  });

  it('groupByBill: ordered groups with summed pools', () => {
    const groups = groupByBill(rows);
    expect(groups.map((g) => g.key)).toEqual([BILL_A, BILL_B]);
    expect(groups[0].rows.map((r) => r.settlementId)).toEqual([2, 3]);
    expect(groups[0].poolUnits).toBe(BigInt(15000));
    expect(groups[1].poolUnits).toBe(BigInt(20000));
  });

  it('sumUnclaimed', () => {
    expect(sumUnclaimed([])).toBe(BigInt(0));
    expect(sumUnclaimed(rows)).toBe(BigInt(35000));
  });
});
