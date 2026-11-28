// P1.4a settlement vector — data contract, deterministic builder + serialization.
// (Render wiring is P1.4b; this file is consumed as a pure, zero-dep module.)
//
// Mirrors the FROZEN TandaBillV2 settlement math EXACTLY (source-verified
// FluxNimbusAi/tanda main contracts/TandaBillV2.sol):
//   - initiateSettlement L243-264: unsettled total split equally across the
//     active roster — `base = unsettled / activeCount`,
//     `remainder = unsettled % activeCount`, `payout[idx] = base + (idx < remainder ? 1 : 0)`
//     for idx dense over seats ascending (leftover units go to the LOWEST ranks).
//   - _payoutAt L405: seat i's share sits at rank = popcount(expectedMask bits
//     below i) — the payout vector is dense over the initiate-time snapshot.
// P1.3 weights are NOT shipped on this contract lineage; every explanation
// below describes the equal-split + low-rank-remainder math the chain runs,
// never aspirational spec prose. bigint-only, zero deps, no Date/locale calls:
// builder, text renderer and canonical serializer are deterministic across
// machines. BigInt() call form throughout — project target is ES2017, no
// bigint literals.
//
// Ruling addendum (C2/Option A, t_0fbf6fba comment 2026-11-17): seats whose
// wallet rotated AFTER full confirmation (rotatedAt > fullyConfirmedAt, event-
// derived via SeatWalletRotated per docs/W10_E2E_RECEIPT) carry a
// rotationAnomaly flag through the vector so the P1.4b renderer can annotate
// the share. The flag is computed off-chain by the caller; this contract only
// transports, explains and serializes it.

import {
  labelFor,
  shortAddress,
  type NamesByWallet,
} from "./identityDisplay.ts";

export const TOKEN_SCALE = 6; // USDC 6 decimals — frozen canonical token

/** Exact sentence fragment appended to an anomalous component's explanation. */
export const ANOMALY_MARK = "⚠ post-confirm rotation anomaly";
const ANOMALY_SENTENCE =
  `${ANOMALY_MARK}: this seat's wallet rotated after full confirmation; ` +
  "per the Option A invariant the payout follows the wallet that confirmed.";

/** Canonical serialization schema tag (data-contract identity). */
export const SETTLEMENT_VECTOR_SCHEMA = "tanda.settlement-vector/1";

const HEX40 = /^0x[a-fA-F0-9]{40}$/;

export type ExpenseTraceEntry = {
  id: number; // expense array index at initiate time
  amount: bigint; // token base units
  paidBy: string; // wallet that fronted the expense
};

export type ComponentDerivation = {
  base: bigint; // unsettled / activeCount
  remainder: bigint; // unsettled % activeCount
  getsRemainderUnit: boolean; // rank < remainder → +1 unit
};

export type VectorComponent = {
  seatId: number; // bill seat index (swap-pop dense)
  wallet: string; // 0x… wallet holding the seat
  rank: number; // dense position: popcount(expectedMask bits below seatId)
  payout: bigint; // token base units owed to this seat
  derivation: ComponentDerivation;
  explanation: string; // generated from the SAME inputs as payout (+ anomaly sentence)
  rotationAnomaly: boolean; // C2/Option A: post-confirm wallet rotation (caller-derived)
};

export type SettlementVector = {
  settlementId: bigint;
  totalAmount: bigint; // settlement.totalAmount snapshot
  scale: number; // token decimals (6)
  components: VectorComponent[]; // ascending seatId, ranks 0..n-1
  expenseTrace: ExpenseTraceEntry[]; // when non-empty: sums to totalAmount
};

export type SeatView = {
  seatId: number;
  wallet: string;
  rotationAnomaly?: boolean; // omit/false when no SeatWalletRotated after fullyConfirmedAt
};

export type SettlementVectorInput = {
  settlementId: bigint;
  totalAmount: bigint;
  expectedMask: bigint; // bit i set = seat i invited into settlement #settlementId
  seats: readonly SeatView[]; // initiate-time roster (seatId → wallet)
  expenseTrace?: readonly ExpenseTraceEntry[];
};

const ONE = BigInt(1);
const ZERO_BI = BigInt(0);

/** True when mask bit at position i is set. */
const bitAt = (mask: bigint, i: number): boolean =>
  ((mask >> BigInt(i)) & ONE) === ONE;

/** Set bits of mask strictly below position `seatId` (contract _payoutAt rank). */
export function popcountBelow(mask: bigint, seatId: number): number {
  let count = 0;
  for (let i = 0; i < seatId; i++) {
    if (bitAt(mask, i)) count++;
  }
  return count;
}

/** Set bits of mask (active roster size at initiate). Scans 256 positions. */
export function popcount(mask: bigint): number {
  let count = 0;
  for (let i = 0; i < 256; i++) {
    if (bitAt(mask, i)) count++;
  }
  return count;
}

/** Exact 6-decimal string — never toLocaleString (locale would break determinism). */
export function formatUnits6(units: bigint): string {
  const neg = units < ZERO_BI;
  const s = (neg ? -units : units).toString().padStart(7, "0");
  return `${neg ? "-" : ""}${s.slice(0, -6)}.${s.slice(-6)}`;
}

// KAIZEN-9 (t_5dbc6910): kept as the canonical fallback so a no-names render
// stays byte-identical to the frozen golden (identityLabel's short form is
// the same function — pinned by src/lib/__tests__/identityDisplay.test.ts).
const shortWallet = shortAddress;

/** One deterministic sentence explaining payout = base + (rank < remainder ? 1 : 0). */
export function describePayout(c: {
  seatId: number;
  wallet: string;
  rank: number;
  activeCount: number;
  payout: bigint;
  derivation: ComponentDerivation;
  totalAmount: bigint;
}): string {
  const { base, remainder, getsRemainderUnit } = c.derivation;
  return (
    `total ${c.totalAmount} units split equally across ${c.activeCount} seat(s) → base ${base} units` +
    (remainder > ZERO_BI
      ? ` with ${remainder} leftover unit(s) awarded to the lowest ranks (rank < ${remainder})`
      : " with no leftover units (exact equal split)") +
    `. Seat ${c.seatId} (${shortWallet(c.wallet)}) is rank ${c.rank}: base ${base}${getsRemainderUnit ? " + 1 leftover unit" : " + 0 leftover units"} = payout ${c.payout} units (${formatUnits6(c.payout)} USDC).`
  );
}

/**
 * Build the settlement vector from initiate-time inputs. Throws on inputs the
 * frozen contract could not have produced (negative amounts, malformed wallet,
 * expected bit with no roster wallet, expense trace that does not sum to the
 * total) — callers treat a throw as "cannot explain faithfully, render
 * nothing", never partial.
 */
export function buildSettlementVector(
  input: SettlementVectorInput,
): SettlementVector {
  const { settlementId, totalAmount, expectedMask, seats } = input;
  if (totalAmount < ZERO_BI)
    throw new Error(`totalAmount negative: ${totalAmount}`);
  if (settlementId < ZERO_BI)
    throw new Error(`settlementId negative: ${settlementId}`);
  if (expectedMask < ZERO_BI)
    throw new Error(`expectedMask negative: ${expectedMask}`);

  const bySeat = new Map<number, SeatView>();
  for (const s of seats) {
    if (!Number.isInteger(s.seatId) || s.seatId < 0) {
      throw new Error(`seat ${s.seatId} not a non-negative integer index`);
    }
    if (!HEX40.test(s.wallet))
      throw new Error(`seat ${s.seatId} wallet not 0x-hex40`);
    if (bySeat.has(s.seatId))
      throw new Error(`duplicate seatId in roster: ${s.seatId}`);
    bySeat.set(s.seatId, s);
  }

  // Every expected bit must resolve to a roster wallet: a seat removed after
  // initiate makes a faithful vector impossible → refuse, do not approximate.
  for (let i = 0; i < 256; i++) {
    if (bitAt(expectedMask, i) && !bySeat.has(i)) {
      throw new Error(`expected seat ${i} missing from initiate-time roster`);
    }
  }
  const expectedSeatIds: number[] = [];
  for (const [seatId] of bySeat) {
    if (bitAt(expectedMask, seatId)) expectedSeatIds.push(seatId);
  }
  expectedSeatIds.sort((a, b) => a - b);

  const activeCount = expectedSeatIds.length;
  if (activeCount === 0 && totalAmount > ZERO_BI) {
    throw new Error(`total ${totalAmount} with no expected seats`);
  }
  const base = activeCount > 0 ? totalAmount / BigInt(activeCount) : ZERO_BI;
  const remainder =
    activeCount > 0 ? totalAmount % BigInt(activeCount) : ZERO_BI;

  const components: VectorComponent[] = expectedSeatIds.map((seatId, rank) => {
    const seat = bySeat.get(seatId) as SeatView;
    const getsRemainderUnit = rank < Number(remainder);
    const payout = base + (getsRemainderUnit ? ONE : ZERO_BI);
    const derivation: ComponentDerivation = {
      base,
      remainder,
      getsRemainderUnit,
    };
    const rotationAnomaly = seat.rotationAnomaly === true;
    const explanation =
      describePayout({
        seatId,
        wallet: seat.wallet,
        rank,
        activeCount,
        payout,
        derivation,
        totalAmount,
      }) + (rotationAnomaly ? ` ${ANOMALY_SENTENCE}` : "");
    return {
      seatId,
      wallet: seat.wallet,
      rank,
      payout,
      derivation,
      explanation,
      rotationAnomaly,
    };
  });

  const expenseTrace: ExpenseTraceEntry[] = (input.expenseTrace ?? []).map(
    (e) => {
      if (e.amount < ZERO_BI)
        throw new Error(`expense ${e.id} negative amount`);
      if (!HEX40.test(e.paidBy))
        throw new Error(`expense ${e.id} paidBy not 0x-hex40`);
      return { id: e.id, amount: e.amount, paidBy: e.paidBy };
    },
  );
  if (expenseTrace.length > 0) {
    const sum = expenseTrace.reduce((acc, e) => acc + e.amount, ZERO_BI);
    if (sum !== totalAmount) {
      throw new Error(`expense trace sums to ${sum}, not total ${totalAmount}`);
    }
  }

  const vector: SettlementVector = {
    settlementId,
    totalAmount,
    scale: TOKEN_SCALE,
    components,
    expenseTrace,
  };
  const problems = verifySettlementVector(vector);
  if (problems.length > 0)
    throw new Error(`internal invariant failure: ${problems.join("; ")}`);
  return vector;
}

/**
 * Recheck every invariant from the vector's own data (used by the builder and
 * by tests): payouts recomputed from derivations must equal component.payout,
 * explanations must embed the exact numbers, anomaly annotation and flag must
 * agree, sums must close, ranks must be dense and ascending. Returns problem
 * strings — empty means the vector is self-consistent and fully explainable.
 */
export function verifySettlementVector(v: SettlementVector): string[] {
  const problems: string[] = [];
  if (v.totalAmount < ZERO_BI) problems.push("negative totalAmount");
  if (v.components.length > 0 && v.totalAmount === ZERO_BI) {
    problems.push("components with zero total");
  }
  let sum = ZERO_BI;
  let base: bigint | null = null;
  let remainder: bigint | null = null;
  v.components.forEach((c, i) => {
    if (c.rank !== i)
      problems.push(
        `rank gap at position ${i}: seat ${c.seatId} has rank ${c.rank}`,
      );
    if (c.payout < ZERO_BI) problems.push(`seat ${c.seatId} negative payout`);
    if (base === null) base = c.derivation.base;
    else if (c.derivation.base !== base)
      problems.push(`inconsistent base at seat ${c.seatId}`);
    if (remainder === null) remainder = c.derivation.remainder;
    else if (c.derivation.remainder !== remainder)
      problems.push(`inconsistent remainder at seat ${c.seatId}`);
    const expectedGets = c.rank < Number(c.derivation.remainder);
    if (c.derivation.getsRemainderUnit !== expectedGets) {
      problems.push(
        `seat ${c.seatId} getsRemainderUnit=${c.derivation.getsRemainderUnit} contradicts rank ${c.rank} < remainder ${c.derivation.remainder}`,
      );
    }
    const recomputed = c.derivation.base + (expectedGets ? ONE : ZERO_BI);
    if (recomputed !== c.payout) {
      problems.push(
        `seat ${c.seatId} payout ${c.payout} != base ${c.derivation.base} + remainder-flag ${expectedGets}`,
      );
    }
    if (c.rotationAnomaly !== c.explanation.includes(ANOMALY_MARK)) {
      problems.push(
        `seat ${c.seatId} rotationAnomaly=${c.rotationAnomaly} disagrees with explanation annotation`,
      );
    }
    // Explainability check: the sentence must embed the SAME numbers it derives.
    if (
      !c.explanation.includes(`base ${c.derivation.base}`) ||
      !c.explanation.includes(`= payout ${c.payout} units`) ||
      !c.explanation.includes(`is rank ${c.rank}`) ||
      !c.explanation.includes(`Seat ${c.seatId}`)
    ) {
      problems.push(
        `seat ${c.seatId} explanation does not match its components`,
      );
    }
    sum += c.payout;
  });
  if (v.components.length > 0 && sum !== v.totalAmount) {
    problems.push(`payouts sum ${sum} != totalAmount ${v.totalAmount}`);
  }
  if (v.expenseTrace.length > 0) {
    const traceSum = v.expenseTrace.reduce((acc, e) => acc + e.amount, ZERO_BI);
    if (traceSum !== v.totalAmount) {
      problems.push(
        `expense trace sums ${traceSum} != totalAmount ${v.totalAmount}`,
      );
    }
  }
  return problems;
}

/**
 * Canonical deterministic serialization — the machine data contract.
 * Fixed key order (schema tag first), bigints encoded as decimal strings,
 * wallets case-folded to lower hex, strings JSON-escaped. Same vector in ⇒
 * byte-identical string out on every machine; safe as an API payload or a
 * hash preimage. JSON.parse of the output recovers every field except the
 * bigint-ness of numerics (by design — decimal strings are the wire form).
 */
export function serializeSettlementVector(v: SettlementVector): string {
  const jstr = (s: string): string => JSON.stringify(s);
  const wallet = (s: string): string => jstr(s.toLowerCase());
  const parts: string[] = [
    `${jstr("schema")}:${jstr(SETTLEMENT_VECTOR_SCHEMA)}`,
    `${jstr("scale")}:${v.scale}`,
    `${jstr("settlementId")}:${jstr(v.settlementId.toString())}`,
    `${jstr("totalAmount")}:${jstr(v.totalAmount.toString())}`,
    `${jstr("components")}:` +
      `[${v.components
        .map(
          (c) =>
            "{" +
            [
              `${jstr("seatId")}:${c.seatId}`,
              `${jstr("rank")}:${c.rank}`,
              `${jstr("wallet")}:${wallet(c.wallet)}`,
              `${jstr("payout")}:${jstr(c.payout.toString())}`,
              `${jstr("rotationAnomaly")}:${c.rotationAnomaly ? "true" : "false"}`,
              `${jstr("derivation")}:` +
                "{" +
                [
                  `${jstr("base")}:${jstr(c.derivation.base.toString())}`,
                  `${jstr("remainder")}:${jstr(c.derivation.remainder.toString())}`,
                  `${jstr("getsRemainderUnit")}:${c.derivation.getsRemainderUnit ? "true" : "false"}`,
                ].join(",") +
                "}",
              `${jstr("explanation")}:${jstr(c.explanation)}`,
            ].join(",") +
            "}",
        )
        .join(",")}]`,
    `${jstr("expenseTrace")}:` +
      `[${v.expenseTrace
        .map(
          (e) =>
            "{" +
            [
              `${jstr("id")}:${e.id}`,
              `${jstr("amount")}:${jstr(e.amount.toString())}`,
              `${jstr("paidBy")}:${wallet(e.paidBy)}`,
            ].join(",") +
            "}",
        )
        .join(",")}]`,
  ];
  return `{${parts.join(",")}}`;
}

/**
 * Deterministic plain-text rendering of the vector — golden-snapshot source and
 * the sr-only block P1.4b's accessible component will embed. Same vector in ⇒
 * same bytes out on every machine (no locale, no clock, no randomness).
 */
export function renderSettlementVectorText(
  v: SettlementVector,
  names?: NamesByWallet,
): string {
  const lines: string[] = [];
  lines.push(`SETTLEMENT #${v.settlementId.toString()}`);
  lines.push(
    `total: ${v.totalAmount.toString()} units (${formatUnits6(v.totalAmount)} USDC, scale ${v.scale})`,
  );
  lines.push(`components: ${v.components.length}`);
  if (v.expenseTrace.length > 0) {
    lines.push(`expense trace: ${v.expenseTrace.length} entries`);
    for (const e of v.expenseTrace) {
      lines.push(
        `  expense #${e.id}: ${e.amount.toString()} units paid by ${labelFor(names, e.paidBy)}`,
      );
    }
  } else {
    lines.push("expense trace: none provided");
  }
  if (v.components.length === 0) {
    lines.push("rows: none — settlement has no expected seats");
  } else {
    lines.push("rows:");
    for (const c of v.components) {
      lines.push(
        `  rank=${c.rank} seat=${c.seatId} wallet=${labelFor(names, c.wallet)} ` +
          `payout=${c.payout.toString()} derivation=${c.derivation.base.toString()}+${c.derivation.getsRemainderUnit ? "1" : "0"} ` +
          `anomaly=${c.rotationAnomaly}`,
      );
    }
    lines.push("explanations:");
    for (const c of v.components) {
      lines.push(`  ${c.explanation}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
