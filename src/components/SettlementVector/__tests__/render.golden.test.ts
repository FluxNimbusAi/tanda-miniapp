// P1.4b visual/golden snapshot — renders the accessible SettlementVectorTable
// to static markup via react-dom/server (component is pure presentational, so
// deterministic static markup IS the visual contract; repo lane has no
// browser runner). A minimal TypeScript-transpile loader bridges .tsx + the
// '@/lib' alias into node --test. Also asserts the accessible-label
// requirements: captioned table, col/row scope, aria-describedby per row,
// aria-labelledby heading, and that the sr-only block is byte-identical to
// renderSettlementVectorText (the golden the contract tests pin).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  buildSettlementVector,
  renderSettlementVectorText,
} from "../../../lib/settlementVector.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "..", "..", "..");
const GOLDEN = join(
  HERE,
  "..",
  "__snapshots__",
  "SettlementVectorTable.golden.html",
);
const require_ = createRequire(import.meta.url);
const React = require_("react");
const ReactDOMServer = require_("react-dom/server");

// ---- tsx loader: transpileModule -> CJS, with '@/lib' + relative resolution --
const loaded = new Map<string, unknown>();
function loadTs(file: string): { createElement: unknown } {
  if (loaded.has(file)) return loaded.get(file) as { createElement: unknown };
  const out = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, // NOT ReactJS — undefined member in TS 5.x public API
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  loaded.set(file, mod.exports);
  const localRequire = (id: string): unknown => {
    if (id.startsWith("@/")) {
      const p = resolve(SRC_ROOT, `${id.slice(2)}.ts`);
      if (existsSync(p)) return loadTs(p);
      const px = resolve(SRC_ROOT, `${id.slice(2)}.tsx`);
      if (existsSync(px)) return loadTs(px);
    }
    if (id.startsWith(".")) {
      const p = resolve(dirname(file), id);
      // KAIZEN-9: honor ids that ALREADY carry their extension (".ts" ids are
      // the node type-stripping doctrine used across this lane).
      if (/\.(ts|tsx)$/.test(p) && existsSync(p)) return loadTs(p);
      for (const cand of [
        `${p}.tsx`,
        `${p}.ts`,
        join(p, "index.tsx`".replace("`", "")),
        join(p, "index.ts"),
      ]) {
        if (existsSync(cand)) return loadTs(cand);
      }
    }
    return require_(id);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", out)(
    mod.exports,
    localRequire,
    mod,
    file,
    dirname(file),
  );
  return mod.exports as { createElement: unknown };
}

const { SettlementVectorTable } = loadTs(
  resolve(SRC_ROOT, "components/SettlementVector/index.tsx"),
) as unknown as {
  SettlementVectorTable: (props: { vector: unknown }) => unknown;
};

const W = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;
const maskOf = (ids: number[]): bigint =>
  ids.reduce((m, i) => m | (BigInt(1) << BigInt(i)), BigInt(0));
const vector = buildSettlementVector({
  settlementId: BigInt(0),
  totalAmount: BigInt(10000000),
  expectedMask: maskOf([0, 1, 2]),
  seats: [0, 1, 2].map((seatId) => ({ seatId, wallet: W(seatId + 1) })),
  expenseTrace: [
    { id: 0, amount: BigInt(6000000), paidBy: W(9) },
    { id: 1, amount: BigInt(4000000), paidBy: W(1) },
  ],
});

const render = (): string =>
  ReactDOMServer.renderToStaticMarkup(
    React.createElement(SettlementVectorTable, { vector }),
  );

test("golden: accessible markup matches the committed snapshot", () => {
  const html = render();
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, html);
    console.log(`golden written: ${GOLDEN}`);
    return;
  }
  assert.equal(html, readFileSync(GOLDEN, "utf8"));
});

test("accessible labels: captioned table, scoped headers, per-row description refs", () => {
  const html = render();
  assert.ok(html.includes("<caption"), "captioned table");
  assert.ok(
    html.includes('aria-labelledby="sv-heading"'),
    "section labelled by heading",
  );
  assert.ok(
    html.match(/<th scope="col"/g)!.length === 4,
    "four column headers",
  );
  assert.ok(
    html.match(/<th scope="row"/g)!.length === 3,
    "row headers per seat",
  );
  for (const seatId of [0, 1, 2]) {
    const ref = `sv-explain-${seatId}`;
    assert.ok(html.includes(`id="${ref}"`), `explanation cell anchor ${ref}`);
    assert.ok(
      html.split('aria-describedby="' + ref + '"').length - 1 === 3,
      `three cells describe via ${ref}`,
    );
  }
  assert.ok(
    html.includes('<span class="sr-only">. total 10000000 units'),
    "per-row sr-only full explanation",
  );
});

test("explanations in DOM match vector components byte-for-byte", () => {
  const html = render();
  const text = renderSettlementVectorText(vector);
  // The canonical text contains HTML-escapable characters (e.g. "rank < 1");
  // renderToStaticMarkup escapes text nodes, so byte-identity is asserted in
  // the channel React actually emits into: apply React's entity map to the
  // raw canonical text and require it verbatim inside the markup.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
  assert.ok(
    html.includes(escaped),
    "sr-only block is the exact canonical text (React-escaped)",
  );
  for (const c of vector.components) {
    // Per-component pins (format as of the canonical serialization):
    // row line "payout=N ..." and explanation sentence "= payout N units".
    assert.ok(
      escaped.includes(`payout=${c.payout.toString()}`),
      `row line pins payout ${c.payout}`,
    );
    assert.ok(
      escaped.includes(`= payout ${c.payout.toString()} units`),
      `explanation derives payout ${c.payout}`,
    );
    assert.ok(
      html.includes(`rank ${c.rank}:`),
      `rank ${c.rank} explanation fragment in markup`,
    );
  }
});

test("empty vector renders a neutral accessible state", () => {
  const empty = buildSettlementVector({
    settlementId: BigInt(0),
    totalAmount: BigInt(0),
    expectedMask: BigInt(0),
    seats: [{ seatId: 0, wallet: W(1) }],
  });
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SettlementVectorTable, { vector: empty }),
  );
  assert.ok(html.includes("nothing to settle"), "neutral empty copy");
  assert.ok(html.includes("<caption"), "captioned even when empty");
});

// ---------------------------------------------------------------------------
// KAIZEN-9 (t_5dbc6910) — CONTRACT CHANGE per the World display law
// (docs.world.org/mini-apps/guidelines/app-guidelines, verified 2026-11-27):
// when a names map is supplied, identity cells AND the sr-only canonical text
// show @handles instead of wallet bytes; unresolved wallets fail-soft to the
// canonical short address. The no-names default staying byte-identical to the
// committed golden above (passing UNMODIFIED) is the fail-soft regression pin.
// ---------------------------------------------------------------------------
test("KAIZEN-9: names map -> @handles replace address bytes in cells + sr-only", () => {
  const names = new Map([
    [W(1), "alice"],
    [W(2), "bob"],
    [W(3), "carol"],
  ]);
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SettlementVectorTable, { vector, names }),
  );
  const text = renderSettlementVectorText(vector, names);
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
  // sr-only bytes STILL match the named canonical rendering (visible==reader).
  assert.ok(
    html.includes(escaped),
    "sr-only block is the named canonical text",
  );
  // Row identity: resolved seats show handles, never address bytes.
  assert.ok(text.includes("seat=0 wallet=@alice"), "row 0 pins @alice");
  assert.ok(text.includes("seat=1 wallet=@bob"), "row 1 pins @bob");
  assert.ok(text.includes("seat=2 wallet=@carol"), "row 2 pins @carol");
  assert.ok(
    !text.includes("wallet=0x0000"),
    "no short address in resolved rows",
  );
  // Expense trace: known payer -> handle; unknown payer -> fail-soft short addr.
  assert.ok(
    text.includes("expense #0: 6000000 units paid by 0x0000…0009"),
    "unknown payer W(9) fail-softs to canonical short address",
  );
  assert.ok(
    text.includes("expense #1: 4000000 units paid by @alice"),
    "known payer W(1) shows @handle",
  );
  // Visible cells (markup), not just sr-only:
  for (const h of ["@alice", "@bob", "@carol"])
    assert.ok(html.includes(h), `${h} visible in table markup`);
});
