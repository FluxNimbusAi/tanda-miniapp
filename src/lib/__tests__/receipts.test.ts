// @vitest-environment node
// APP-3 (t_147cd41a) golden: pure receipt builder. Pins the C3 idempotency
// charset against the ACTUAL /api/notify KEY_RE, the KAIZEN-9 ${username}
// token, the 72/280 copy bounds, the P1.1b root-relative path law (no
// worldapp:// on the wire, no query), the functional register
// (no demo|beta|trial, no exclamation), and the fail-closed anchors.
import { describe, expect, it } from "vitest";
import {
  buildReceipt,
  receiptCopy,
  type ReceiptContext,
  type ReceiptEvent,
} from "../receipts";

// verbatim from src/app/api/notify/route.ts (C3 HARD ENFORCEMENT)
const KEY_RE = /^[A-Za-z0-9:._-]{8,128}$/;

// Golden fixtures must be TRUE 40-hex addresses — the builder is fail-closed
// to null on any malformed anchor, so short fixtures silently test nothing.
const WALLET = "0xAbC0000000000000000000000000000000001234"; // 40 hex
const BILL = "0xDeF0000000000000000000000000000000004567"; // exactly 40 hex (count-verified)
const HASH = `0x${"a1".repeat(32)}`;
const EVENTS: ReceiptEvent[] = [
  "executeSettlement",
  "refundSettlement",
  "claimSettlement",
];
const ctx = (over: Partial<ReceiptContext> = {}): ReceiptContext => ({
  wallet: WALLET,
  userOpHash: HASH,
  ...over,
});

describe.each(EVENTS)("%s receipt copy law", (event) => {
  const { title, message } = receiptCopy(event, ctx({ usdc: "12.50", count: 3 }));
  it("fits the API bounds (title <=72, message <=280)", () => {
    expect(title.length).toBeLessThanOrEqual(72);
    expect(message.length).toBeLessThanOrEqual(280);
    // worst case too: max-length figure cannot blow the budget
    const worst = receiptCopy(event, ctx({ usdc: "12345678.90", count: 999 }));
    expect(worst.message.length).toBeLessThanOrEqual(280);
  });
  it("addresses the recipient by ${username} (KAIZEN-9 display law)", () => {
    expect(message).toContain("${username}");
  });
  it("keeps the functional register: no '!', no demo|beta|trial", () => {
    const all = `${title} ${message}`;
    expect(all).not.toContain("!");
    expect(/\b(demo|beta|trial)\b/i.test(all)).toBe(false);
  });
});

describe("buildReceipt payload shape", () => {
  it("single lowercased actor wallet; root-relative /bill path (P1.1b)", () => {
    const p = buildReceipt("executeSettlement", ctx({ bill: BILL, usdc: "40.00" }));
    expect(p).not.toBeNull();
    expect(p!.wallet_addresses).toEqual([WALLET.toLowerCase()]);
    expect(p!.mini_app_path).toBe(`/bill/${BILL.toLowerCase()}`);
    expect(p!.mini_app_path.startsWith("worldapp://")).toBe(false);
    expect(p!.mini_app_path).not.toContain("?");
    expect(p!.localisations[0]!.message).toContain("40.00 USDC");
  });
  it("multi-bill sweep (no bill) lands on /home", () => {
    expect(buildReceipt("claimSettlement", ctx({ count: 2 }))!.mini_app_path).toBe(
      "/home",
    );
  });
  it("idempotency key is rcpt:<event>:<userOpHash> and passes the route KEY_RE", () => {
    const p = buildReceipt("claimSettlement", ctx())!;
    expect(p.idempotency_key).toBe(`rcpt:claimSettlement:${HASH}`);
    expect(KEY_RE.test(p.idempotency_key)).toBe(true);
    // deterministic: same anchors -> same key (replay is deduped, not re-sent)
    expect(buildReceipt("claimSettlement", ctx())!.idempotency_key).toBe(
      p.idempotency_key,
    );
  });
  it("omits the USDC figure when unknown — honest copy, never a fake amount", () => {
    expect(buildReceipt("refundSettlement", ctx())!.localisations[0]!.message).toContain(
      "the escrow",
    );
    expect(buildReceipt("executeSettlement", ctx())!.localisations[0]!.message).toContain(
      "the bill",
    );
  });
  it("claim copy pluralizes the bill count", () => {
    expect(receiptCopy("claimSettlement", ctx({ count: 2 })).message).toContain(
      "2 settled bills",
    );
    expect(receiptCopy("claimSettlement", ctx({ count: 1 })).message).toContain(
      "1 settled bill",
    );
    expect(receiptCopy("claimSettlement", ctx()).message).toContain(
      "1 settled bill",
    );
  });
});

describe("fail-closed anchors (never dispatch garbage into the keyed lane)", () => {
  it.each([
    ["malformed wallet", ctx({ wallet: "0xnope" })],
    ["non-hex userOpHash", ctx({ userOpHash: "0xyz" })],
    ["short userOpHash", ctx({ userOpHash: `0x${"aa".repeat(31)}` })],
    ["missing 0x prefix", ctx({ userOpHash: "a1".repeat(32) })],
    ["malformed bill", ctx({ bill: "not-an-address" })],
  ])("%s -> null", (_name, c) => {
    expect(buildReceipt("executeSettlement", c)).toBeNull();
  });
});
