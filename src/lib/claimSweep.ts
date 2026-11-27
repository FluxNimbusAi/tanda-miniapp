// KAIZEN-5 (t_86b44100, H4/H5): per-bill claim selection + accrual framing.
// Pure, deterministic logic lane for the pull-claim sweep. The /api/claims
// feed returns (bill, settlement) rows where the wallet holds a seat grant
// but has NO seat claim yet; buildSweepPlan turns selected rows into N
// factory.callBill(clone claimSettlement(id)) wrappers — MiniKit.sendTransaction
// takes a transactions ARRAY, so one signature sweeps many bills.
// ZERO contract change: claimSettlement(settlementId) already exists on the
// V3 pair (TandaBillV2 ABI).
//
// Honest-math rule (recon lock): the ONLY money figure shown is the
// bill-level unclaimed POOL (total_amount - claimed_amount from the index).
// Per-seat payout is never fabricated from the partial index — claimablePayout
// is a chain-side view call; until it is wired, the UI says "waiting for you",
// not "you get X".
//
// ES2017 target discipline (tsconfig): BigInt(x) calls, never 1n literals.
import { billAction, type ActionSpec } from './billActions';
import type { Address } from 'viem';

/** One claimable (bill, settlement) pair for the current wallet. */
export type ClaimRow = {
  bill: Address;
  settlementId: number;
  /** Bill-level unclaimed pool, raw 6-decimal USDC units. NOT a per-seat figure. */
  unclaimedUnits: bigint;
  /** Unix seconds of SettlementSettled; null only from degraded feeds. */
  settledAt: number | null;
};

/** Stable selection key for a bill (lowercased address). */
export function billKey(bill: Address): string {
  return bill.toLowerCase();
}

/** Deterministic ordering: bill address lex (lowercased), then settlementId. */
export function compareRows(a: ClaimRow, b: ClaimRow): number {
  const ka = billKey(a.bill);
  const kb = billKey(b.bill);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return a.settlementId - b.settlementId;
}

/**
 * Build the batched sweep: sort selected rows, drop zero-pool rows (nothing
 * to pull — keeps the userOp honest and gas-tight), encode each claim via the
 * frozen factory pass-through. Output order === signature order.
 */
export function buildSweepPlan(
  entries: readonly ClaimRow[],
  factory: Address,
): ActionSpec[] {
  return entries
    .filter((e) => e.unclaimedUnits > BigInt(0))
    .slice()
    .sort(compareRows)
    .map((e) =>
      billAction(e.bill, factory, 'claimSettlement', [BigInt(e.settlementId)]),
    );
}

/** Sum of bill-level pools across rows (units, never float). */
export function sumUnclaimed(rows: readonly ClaimRow[]): bigint {
  return rows.reduce((acc, r) => acc + r.unclaimedUnits, BigInt(0));
}

/** Group rows by bill for the H5 checkbox list (bill order = sort order). */
export type BillGroup = {
  bill: Address;
  key: string;
  rows: ClaimRow[];
  poolUnits: bigint;
};

export function groupByBill(rows: readonly ClaimRow[]): BillGroup[] {
  const byBill = new Map<string, BillGroup>();
  for (const r of rows.slice().sort(compareRows)) {
    const k = billKey(r.bill);
    let g = byBill.get(k);
    if (!g) {
      g = { bill: r.bill, key: k, rows: [], poolUnits: BigInt(0) };
      byBill.set(k, g);
    }
    g.rows.push(r);
    g.poolUnits += r.unclaimedUnits;
  }
  return [...byBill.values()];
}

/**
 * H5 selection semantics: one checkbox per BILL (a bill toggles all of its
 * settlements together — partial-bill selection invites double-tap reverts).
 * Pure add/remove returning a new sorted key list.
 */
export function toggleBillSelection(
  selected: readonly string[],
  key: string,
): string[] {
  const k = key.toLowerCase();
  const set = new Set(selected.map((s) => s.toLowerCase()));
  if (set.has(k)) set.delete(k);
  else set.add(k);
  return [...set].sort();
}

/** Rows covered by the selected bill keys, in sweep order. */
export function selectedRows(
  rows: readonly ClaimRow[],
  selected: readonly string[],
): ClaimRow[] {
  const sel = new Set(selected.map((s) => s.toLowerCase()));
  return rows.filter((r) => sel.has(billKey(r.bill))).sort(compareRows);
}

/** Raw 6-decimal USDC units -> human figure string. Pure bigint, no float. */
export function formatUSDC(units: bigint): string {
  const neg = units < BigInt(0);
  const abs = neg ? -units : units;
  const whole = abs / BigInt(1000000);
  const frac = (abs % BigInt(1000000)).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * H4 pileup framing: waiting money is LOSS-AVERSION copy, not a neutral list.
 * 0 = all-clear (never shown when the component hides itself); 1 = single
 * claim nudge; >1 = the pileup call-to-action. Deterministic strings for
 * golden tests — no randomness, no clock reads.
 */
export function accrualCopy(n: number, totalUnits: bigint): string {
  if (n <= 0) return 'Nothing waiting — every settled bill is claimed.';
  const usdc = formatUSDC(totalUnits);
  if (n === 1)
    return `${usdc} USDC is still waiting in 1 settled bill. One tap to pull it.`;
  return `${usdc} USDC is piling up across ${n} settled bills. Sweep them all in one signature.`;
}

/** CTA label copy for the current selection (never invites an empty send). */
export function sweepCtaCopy(k: number, totalUnits: bigint): string {
  if (k <= 0) return 'Select a bill to sweep';
  return `Sweep ${formatUSDC(totalUnits)} USDC from ${k} bill${k === 1 ? '' : 's'}`;
}
