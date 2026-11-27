// @vitest-environment node
// C4 golden: /api/bills-for wire contract — shape, validation, degradation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const tmp = mkdtempSync(path.join(tmpdir(), "billsfor-"));
const DB = path.join(tmp, "bill_index.db");
process.env.TANDA_INDEX_DB = DB;

const W1 = "0x1111111111111111111111111111111111111111";

beforeAll(() => {
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE settlements (bill_id TEXT, amount_units TEXT, tx_hash TEXT, settled_at INTEGER, fully_confirmed_at INTEGER, refunded INTEGER);
           CREATE TABLE seat_grants (bill_id TEXT, wallet_address TEXT);`);
  db.prepare("INSERT INTO settlements VALUES (?,?,?,?,?,?)").run("b7", "2500000", "0xdead", 100, 90, 0);
  db.prepare("INSERT INTO settlements VALUES (?,?,?,?,?,?)").run("b8", null, "0xbeef", null, null, 0);
  db.prepare("INSERT INTO seat_grants VALUES (?,?)").run("b7", "0x" + W1.slice(2).toUpperCase());
  db.prepare("INSERT INTO seat_grants VALUES (?,?)").run("b8", W1);
  db.close();
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function reqWith(address: string) {
  return { nextUrl: { searchParams: new URLSearchParams({ address }) } } as never;
}

describe("/api/bills-for (C4)", () => {
  it("400 on malformed address", async () => {
    const { GET } = await import("../route");
    expect((await GET(reqWith("nope"))).status).toBe(400);
  });
  it("case-insensitive join, precedence statuses, no internals on wire", async () => {
    const { GET } = await import("../route");
    const body = await (await GET(reqWith("0x" + W1.slice(2).toUpperCase()))).json();
    expect(body.count).toBe(2);
    expect(body.address).toBe(W1);
    expect(body.bills.map((b: { status: string }) => b.status)).toEqual(["executed", "initiated"]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain("wallet_address");
    expect(wire).not.toContain("nullifier");
    expect(wire).not.toContain("fully_confirmed_at");
  });
  it("degradation: unreadable DB -> empty list at 200, never an error", async () => {
    process.env.TANDA_INDEX_DB = path.join(tmp, "absent.db");
    const { GET } = await import("../route");
    const res = await GET(reqWith(W1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bills).toEqual([]);
    expect(body.count).toBe(0);
    process.env.TANDA_INDEX_DB = DB;
  });
});
