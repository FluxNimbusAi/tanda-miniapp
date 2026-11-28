// P1.4a tests — node --test (Node 26 strips TS types natively; tsconfig carries
// allowImportingTsExtensions for this lane). Covers the builder's
// empty/normal/edge shapes, the explanation↔payout invariant, the
// contract-math mirror (equal split + lowest-rank remainder, dense over
// expectedMask), the C2/Option A rotation-anomaly transport, canonical
// serialization determinism, input validation, and a golden text snapshot.
// BigInt() call form throughout — project target is ES2017, no bigint literals.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ANOMALY_MARK,
  SETTLEMENT_VECTOR_SCHEMA,
  buildSettlementVector,
  formatUnits6,
  popcount,
  popcountBelow,
  renderSettlementVectorText,
  serializeSettlementVector,
  verifySettlementVector,
  type SeatView,
  type SettlementVector,
} from "../settlementVector.ts";

const BI = BigInt;
const W = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;
const roster = (...ids: number[]): SeatView[] =>
  ids.map((seatId) => ({ seatId, wallet: W(seatId + 1) }));
const maskOf = (ids: number[]): bigint =>
  ids.reduce((m, i) => m | (BI(1) << BI(i)), BI(0));

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "__snapshots__", "settlementVector.golden.txt");

test("empty vector: zero total, no expected seats renders a neutral vector", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(0),
    expectedMask: BI(0),
    seats: roster(0, 1),
  });
  assert.equal(v.components.length, 0);
  assert.deepEqual(verifySettlementVector(v), []);
});

test("empty vector rejects a positive total with no seats", () => {
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(5),
        expectedMask: BI(0),
        seats: roster(0),
      }),
    /no expected seats/,
  );
});

test("normal vector: 10 USDC across 3 seats → 3333334 + 3333333 + 3333333", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(10000000),
    expectedMask: maskOf([0, 1, 2]),
    seats: roster(0, 1, 2),
  });
  assert.deepEqual(
    v.components.map((c) => c.payout),
    [BI(3333334), BI(3333333), BI(3333333)],
  );
  assert.deepEqual(
    v.components.map((c) => c.rank),
    [0, 1, 2],
  );
  assert.equal(
    v.components.reduce((a, c) => a + c.payout, BI(0)),
    BI(10000000),
  );
  assert.deepEqual(verifySettlementVector(v), []);
  // Explanation matches the number it accompanies (per-component check).
  for (const c of v.components) {
    assert.ok(c.explanation.includes(`= payout ${c.payout} units`));
    assert.ok(c.explanation.includes(`is rank ${c.rank}`));
    assert.ok(c.explanation.includes(`Seat ${c.seatId}`));
    assert.ok(!c.explanation.includes(ANOMALY_MARK));
  }
});

test("exact split: remainder 0 → every seat gets base, no leftover language", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(9000000),
    expectedMask: maskOf([0, 1, 2]),
    seats: roster(0, 1, 2),
  });
  assert.deepEqual(
    v.components.map((c) => c.payout),
    [BI(3000000), BI(3000000), BI(3000000)],
  );
  assert.ok(
    v.components[0].explanation.includes(
      "no leftover units (exact equal split)",
    ),
  );
});

test("edge: total smaller than seat count → only lowest ranks receive 1 unit", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(2),
    expectedMask: maskOf([0, 1, 2, 3, 4]),
    seats: roster(0, 1, 2, 3, 4),
  });
  assert.deepEqual(
    v.components.map((c) => c.payout),
    [BI(1), BI(1), BI(0), BI(0), BI(0)],
  );
  assert.equal(
    v.components.reduce((a, c) => a + c.payout, BI(0)),
    BI(2),
  );
});

test("edge: sparse expectedMask — ranks dense over mask bits, _payoutAt parity", () => {
  // 4-seat bill, but settlement invited only seats 1 and 3 (contract: payout
  // vector dense over expectedMask; seat i rank = popcount(bits below i)).
  const mask = maskOf([1, 3]);
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(7),
    expectedMask: mask,
    seats: roster(0, 1, 2, 3),
  });
  assert.deepEqual(
    v.components.map((c) => c.seatId),
    [1, 3],
  );
  assert.deepEqual(
    v.components.map((c) => c.rank),
    [0, 1],
  );
  assert.deepEqual(
    v.components.map((c) => c.payout),
    [BI(4), BI(3)],
  );
  assert.equal(popcountBelow(mask, 3), 1);
  assert.equal(popcount(mask), 2);
});

test("edge: leftover expected seat missing from roster is refused, never approximated", () => {
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(10),
        expectedMask: maskOf([0, 2]),
        seats: roster(0),
      }),
    /expected seat 2 missing/,
  );
});

test("expense trace: entries must sum to the settlement total", () => {
  const trace = [
    { id: 0, amount: BI(6000000), paidBy: W(9) },
    { id: 1, amount: BI(4000000), paidBy: W(1) },
  ];
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(10000000),
    expectedMask: maskOf([0, 1, 2]),
    seats: roster(0, 1, 2),
    expenseTrace: trace,
  });
  assert.equal(
    v.expenseTrace.reduce((a, e) => a + e.amount, BI(0)),
    v.totalAmount,
  );
  assert.deepEqual(verifySettlementVector(v), []);
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(10000000),
        expectedMask: maskOf([0, 1, 2]),
        seats: roster(0, 1, 2),
        expenseTrace: [{ id: 0, amount: BI(1), paidBy: W(9) }],
      }),
    /expense trace sums to 1, not total 10000000/,
  );
});

test("input validation: negatives, malformed wallets and duplicate seats are rejected", () => {
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(-1),
        totalAmount: BI(0),
        expectedMask: BI(0),
        seats: [],
      }),
    /settlementId negative/,
  );
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(-5),
        expectedMask: BI(0),
        seats: [],
      }),
    /totalAmount negative/,
  );
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(0),
        expectedMask: BI(0),
        seats: [
          { seatId: 0, wallet: W(1) },
          { seatId: 0, wallet: W(2) },
        ],
      }),
    /duplicate seatId/,
  );
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(0),
        expectedMask: BI(0),
        seats: [{ seatId: 0, wallet: "0xdeadbeef" }],
      }),
    /wallet not 0x-hex40/,
  );
  assert.throws(
    () =>
      buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(0),
        expectedMask: maskOf([0]),
        seats: [
          { seatId: 0, wallet: W(1) },
          { seatId: -2, wallet: W(2) },
        ],
      }),
    /not a non-negative integer/,
  );
});

test("ruling addendum C2/Option A: rotationAnomaly transports, annotates, serializes", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(7),
    expectedMask: maskOf([1, 3]),
    seats: [
      { seatId: 1, wallet: W(2), rotationAnomaly: true },
      { seatId: 3, wallet: W(4), rotationAnomaly: false },
    ],
  });
  assert.deepEqual(
    v.components.map((c) => c.rotationAnomaly),
    [true, false],
  );
  assert.ok(v.components[0].explanation.includes(ANOMALY_MARK));
  assert.ok(
    v.components[0].explanation.includes(
      "payout follows the wallet that confirmed",
    ),
  );
  assert.ok(!v.components[1].explanation.includes(ANOMALY_MARK));
  assert.deepEqual(verifySettlementVector(v), []);
  const text = renderSettlementVectorText(v);
  assert.ok(text.includes("anomaly=true"));
  assert.ok(text.includes("anomaly=false"));
});

test("tampered vector: verifier catches payout/explanation mismatch", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(10000000),
    expectedMask: maskOf([0, 1, 2]),
    seats: roster(0, 1, 2),
  });
  const tampered: SettlementVector = {
    ...v,
    components: v.components.map((c, i) =>
      i === 0 ? { ...c, payout: c.payout + BI(1) } : c,
    ),
  };
  const problems = verifySettlementVector(tampered);
  assert.ok(problems.some((p) => p.includes("payout 3333335 != base")));
  assert.ok(problems.some((p) => p.includes("payouts sum")));
});

test("tampered vector: verifier catches anomaly flag/annotation divergence", () => {
  const v = buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(2),
    expectedMask: maskOf([0, 1]),
    seats: roster(0, 1),
  });
  const tampered: SettlementVector = {
    ...v,
    components: v.components.map((c, i) =>
      i === 0 ? { ...c, rotationAnomaly: true } : c,
    ),
  };
  const problems = verifySettlementVector(tampered);
  assert.ok(
    problems.some((p) =>
      p.includes("rotationAnomaly=true disagrees with explanation annotation"),
    ),
  );
});

test("property sweep: sum==total, spread<=1, low ranks never lose to high ranks", () => {
  for (let total = 7; total <= 120; total += 7) {
    for (let count = 1; count <= 5; count++) {
      const ids = Array.from({ length: count }, (_, i) => i);
      const v = buildSettlementVector({
        settlementId: BI(0),
        totalAmount: BI(total),
        expectedMask: maskOf(ids),
        seats: roster(...ids),
      });
      assert.equal(
        v.components.reduce((a, c) => a + c.payout, BI(0)),
        BI(total),
        `sum total=${total} count=${count}`,
      );
      const payouts = v.components.map((c) => c.payout);
      const max = payouts.reduce((a, b) => (a > b ? a : b));
      const min = payouts.reduce((a, b) => (a < b ? a : b));
      assert.ok(max - min <= BI(1), `spread total=${total} count=${count}`);
      for (let i = 1; i < payouts.length; i++)
        assert.ok(payouts[i - 1] >= payouts[i]);
    }
  }
});

test("formatUnits6 is locale-free and exact", () => {
  assert.equal(formatUnits6(BI(10000000)), "10.000000");
  assert.equal(formatUnits6(BI(1)), "0.000001");
  assert.equal(formatUnits6(BI(0)), "0.000000");
  assert.equal(formatUnits6(BI(123456789)), "123.456789");
});

test("canonical serializer: fixed key order, bigint-safe, case-folded wallets, byte-stable", () => {
  const mixedCase = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const v = buildSettlementVector({
    settlementId: BI(7),
    totalAmount: BI(3),
    expectedMask: maskOf([0, 1]),
    seats: [
      { seatId: 0, wallet: mixedCase, rotationAnomaly: true },
      { seatId: 1, wallet: W(2) },
    ],
    expenseTrace: [{ id: 0, amount: BI(3), paidBy: mixedCase }],
  });
  const s = serializeSettlementVector(v);
  // Byte-stable across repeated calls on the same object…
  assert.equal(s, serializeSettlementVector(v));
  // …and across an object rebuilt with scrambled property insertion order.
  // Manual stringify: JSON.stringify chokes on BigInt, and the whole point of
  // this leg is an object with scrambled property order + decimal-string nums.
  const scrambled = {
    components: v.components.map((c) => ({
      explanation: c.explanation,
      rotationAnomaly: c.rotationAnomaly,
      seatId: c.seatId,
      wallet: c.wallet,
      rank: c.rank,
      payout: String(c.payout),
      derivation: {
        getsRemainderUnit: c.derivation.getsRemainderUnit,
        base: String(c.derivation.base),
        remainder: String(c.derivation.remainder),
      },
    })),
    scale: v.scale,
    settlementId: String(v.settlementId),
    totalAmount: String(v.totalAmount),
    expenseTrace: (v.expenseTrace ?? []).map((e) => ({
      paidBy: e.paidBy,
      amount: String(e.amount),
      id: e.id,
    })),
  } as unknown as SettlementVector;
  const rebuilt: SettlementVector = {
    expenseTrace: (scrambled as SettlementVector).expenseTrace.map((e) => ({
      paidBy: e.paidBy,
      amount: BI(e.amount as unknown as string),
      id: e.id,
    })),
    components: (scrambled as SettlementVector).components.map((c) => ({
      explanation: c.explanation,
      rotationAnomaly: c.rotationAnomaly,
      derivation: {
        getsRemainderUnit: c.derivation.getsRemainderUnit,
        remainder: BI(c.derivation.remainder as unknown as string),
        base: BI(c.derivation.base as unknown as string),
      },
      payout: BI(c.payout as unknown as string),
      seatId: c.seatId,
      wallet: c.wallet,
      rank: c.rank,
    })),
    scale: (scrambled as SettlementVector).scale,
    totalAmount: BI(
      (scrambled as SettlementVector).totalAmount as unknown as string,
    ),
    settlementId: BI(
      (scrambled as SettlementVector).settlementId as unknown as string,
    ),
  };
  assert.equal(s, serializeSettlementVector(rebuilt));
  // Schema tag first, fixed field order in every object, wallets lower-hex.
  assert.ok(
    s.startsWith(
      `{"schema":"${SETTLEMENT_VECTOR_SCHEMA}","scale":6,"settlementId":"7","totalAmount":"3"`,
    ),
  );
  assert.ok(s.includes(mixedCase.toLowerCase()));
  assert.ok(!s.includes(mixedCase));
  assert.ok(s.includes('"payout":"2"')); // bigint on the wire as decimal string
  // Valid JSON recovers every field.
  const parsed = JSON.parse(s) as {
    schema: string;
    components: { wallet: string }[];
  };
  assert.equal(parsed.schema, SETTLEMENT_VECTOR_SCHEMA);
  assert.equal(parsed.components.length, 2);
});

// ---- golden snapshot (deterministic text rendering) -----------------------

const fixtures: SettlementVector[] = [
  buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(0),
    expectedMask: BI(0),
    seats: roster(0, 1),
  }),
  buildSettlementVector({
    settlementId: BI(0),
    totalAmount: BI(10000000),
    expectedMask: maskOf([0, 1, 2]),
    seats: roster(0, 1, 2),
    expenseTrace: [
      { id: 0, amount: BI(6000000), paidBy: W(9) },
      { id: 1, amount: BI(4000000), paidBy: W(1) },
    ],
  }),
  buildSettlementVector({
    settlementId: BI(3),
    totalAmount: BI(2),
    expectedMask: maskOf([1, 3]),
    seats: roster(0, 1, 2, 3),
  }),
  buildSettlementVector({
    settlementId: BI(4),
    totalAmount: BI(7),
    expectedMask: maskOf([1, 3]),
    seats: [
      { seatId: 1, wallet: W(2), rotationAnomaly: true },
      { seatId: 3, wallet: W(4) },
    ],
  }),
];

test("golden: text renderer matches the committed snapshot", () => {
  // KAIZEN-9: explicit no-names call — the renderer's default MUST stay
  // byte-identical to the frozen golden (fail-soft regression pin).
  const rendered = fixtures
    .map((v) => renderSettlementVectorText(v))
    .join("=====\n");
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, rendered);
    console.log(`golden written: ${GOLDEN}`);
    return;
  }
  assert.equal(rendered, readFileSync(GOLDEN, "utf8"));
});
