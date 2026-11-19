// t_76fdc0c4 / Flux ruling D3 11-19 [SETTLE-READ-ENDPOINT]: golden contract for
// GET /settlements — the client-facing READ route over the :8096 canonical
// indexer DB (settlements summary table, single-writer invariant preserved:
// opened node:sqlite readOnly, never written).
//
// This test is the CONTRACT, authored test-first (TDD per the card). Pinned
// properties:
//  1. Response shape is EXACTLY { settlements: [ {bill_id, seat_ref?, amount?,
//     tx_hash?, status} ], count } — no extra top-level or row keys.
//  2. ?bill= is an OPTIONAL filter; malformed bill -> 400 before any DB touch.
//  3. Row identity: one row per canonical settlement summary, ordered by
//     (bill_id, settlement_id). status derives ONLY from SR-003 F12 lifecycle
//     columns with precedence refunded > executed > fully_confirmed > initiated.
//  4. amount is a decimal string (token base units; TEXT cast so >2^53 values
//     never transit float64). tx_hash/bill_id lowercased like seat-grants keys.
//  5. NO SECRETS: rows never carry wallet, nullifier, private material, or any
//     indexer-internal column (block, log_index, recorded_at, claimed_*).
//  6. READ-ONLY: the fixture DB file bytes are bit-identical after serving.
//  7. Degradation: missing table / missing DB file -> {settlements:[],count:0}
//     at 200 — never an error state (lane posture of /api/seat-grants).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

// Same guarded require pattern as /api/seat-grants: @types/node ^20 has no
// node:sqlite typings; CI runs Node >= 22.5 where the module is present.
const nodeRequire = createRequire(import.meta.url);
type SqliteStmt = { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { exec(sql: string): void; prepare(sql: string): SqliteStmt; close(): void };
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => SqliteDb;
};

const BILL_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BILL_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TX1 = '0x' + '11'.repeat(32);
const TX2 = '0x' + '22'.repeat(32);
const TX3 = '0x' + '33'.repeat(32);
const TX4 = '0x' + '44'.repeat(32);

type Row = Record<string, unknown>;
type Body = { settlements?: Row[]; count?: number; error?: string };

const dir = mkdtempSync(path.join(tmpdir(), 'tanda-settle-'));
const CANON_DB = path.join(dir, 'canon.db');
const NOTABLE_DB = path.join(dir, 'no_table.db');
const MISSING_DB = path.join(dir, 'does-not-exist.db');

{
  // Canonical layout per tanda services/bill_index.py (SR-KP-A1 + SR-003 F12):
  // summary table + lifecycle parity columns. A seat_grants table with a
  // nullifier row is planted on purpose: the read route must never leak it.
  const db = new DatabaseSync(CANON_DB);
  db.exec(`CREATE TABLE settlements (
    bill_id TEXT NOT NULL,
    settlement_id NUMERIC NOT NULL,
    user_op_hash TEXT,
    tx_hash TEXT NOT NULL,
    block NUMERIC,
    total_amount NUMERIC,
    settled_at NUMERIC,
    confirmed_at TEXT NOT NULL,
    initiated_block NUMERIC,
    fully_confirmed_at NUMERIC,
    refunded INTEGER NOT NULL DEFAULT 0,
    claimed_count NUMERIC NOT NULL DEFAULT 0,
    claimed_amount NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (bill_id, settlement_id)
  )`);
  db.exec('CREATE TABLE seat_grants (bill_address TEXT, wallet_address TEXT, nullifier TEXT)');
  db.exec(
    `INSERT INTO seat_grants VALUES ('${BILL_A}', '${'0x'.padEnd(42, '1')}', 'SECRET-NULLIFIER-DO-NOT-LEAK')`,
  );
  const ins = db.prepare(
    'INSERT INTO settlements (bill_id, settlement_id, tx_hash, total_amount, settled_at,' +
      ' confirmed_at, initiated_block, fully_confirmed_at, refunded, claimed_count, claimed_amount)' +
      ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  // BILL_A stored UPPERCASED on purpose -> proves lower(bill_id) filtering and
  // row normalization end to end (same discipline as the seat-grants fixture).
  // s1: initiated only (amount present, not executed).
  ins.run(BILL_A.toUpperCase(), 1, TX1, 2500000, null, 'x', 100, null, 0, 0, 0);
  // s2: fully confirmed (big amount beyond 2^53 -> must survive as exact string).
  ins.run(BILL_A.toUpperCase(), 2, TX2, BigInt('9007199254740993'), null, 'x', 120, 555, 0, 0, 0);
  // s3: executed (settled_at set) AND partially claimed -> status stays 'executed'.
  ins.run(BILL_A.toUpperCase(), 3, TX3, 500, 666, 'x', 130, 600, 0, 2, 400);
  // s4: refunded AFTER execution (terminal) -> 'refunded'.
  ins.run(BILL_A.toUpperCase(), 4, TX4, 700, 777, 'x', 140, 700, 1, 0, 0);
  // BILL_B s0: initiated with NULL amount -> amount key omitted from the row.
  ins.run(BILL_B, 0, TX1, null, null, 'x', 90, null, 0, 0, 0);
  db.close();
}
new DatabaseSync(NOTABLE_DB).close(); // file exists, zero tables

async function get(query: string, dbFile: string): Promise<{ status: number; body: Body }> {
  process.env.TANDA_INDEX_DB = dbFile;
  vi.resetModules();
  const { GET } = await import('../route');
  const req = {
    nextUrl: new URL(`http://localhost/settlements${query}`),
  } as unknown as NextRequest;
  const res = (await GET(req)) as unknown as Response;
  return { status: res.status, body: (await res.json()) as Body };
}

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

beforeAll(() => {
  if (!MISSING_DB.endsWith('does-not-exist.db')) throw new Error('fixture guard');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /settlements golden contract (t_76fdc0c4, TDD-first)', () => {
  it('pins the exact wire shape {settlements:[{bill_id, seat_ref?, amount?, tx_hash?, status}], count}', async () => {
    const r = await get('', CANON_DB);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['count', 'settlements']);
    const rows = r.body.settlements!;
    expect(Array.isArray(rows)).toBe(true);
    expect(r.body.count).toBe(rows.length);
    // 5 canonical settlement summaries, ordered by (bill_id, settlement_id).
    expect(rows.length).toBe(5);
    const ALLOWED = new Set(['bill_id', 'seat_ref', 'amount', 'tx_hash', 'status']);
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        expect(ALLOWED.has(k), `unexpected row key ${k}`).toBe(true);
        expect(['bill_id', 'tx_hash', 'status'].includes(k) || row[k] !== null, `${k} must never be null`).toBe(true);
      }
      expect(typeof row.bill_id).toBe('string');
      expect(row.bill_id).toBe(String(row.bill_id).toLowerCase());
      expect(typeof row.tx_hash).toBe('string');
      expect(row.tx_hash).toBe(String(row.tx_hash).toLowerCase());
      expect(['initiated', 'fully_confirmed', 'executed', 'refunded']).toContain(row.status);
      if ('amount' in row) expect(typeof row.amount).toBe('string');
      if ('seat_ref' in row) expect(typeof row.seat_ref).toBe('string');
    }
    // Full golden payload, byte-for-bill: lifecycle precedence is honest
    // against the SR-003 F12 columns (refunded > executed > fully_confirmed > initiated).
    expect(rows).toEqual([
      { bill_id: BILL_A, amount: '2500000', tx_hash: TX1, status: 'initiated' },
      { bill_id: BILL_A, amount: '9007199254740993', tx_hash: TX2, status: 'fully_confirmed' },
      { bill_id: BILL_A, amount: '500', tx_hash: TX3, status: 'executed' },
      { bill_id: BILL_A, amount: '700', tx_hash: TX4, status: 'refunded' },
      { bill_id: BILL_B, tx_hash: TX1, status: 'initiated' },
    ]);
  });

  it('?bill= optional filter narrows rows and count; matches case-insensitively', async () => {
    const upper = await get(`?bill=${BILL_A.toUpperCase()}`, CANON_DB);
    expect(upper.status).toBe(200);
    expect(upper.body.count).toBe(4);
    expect(upper.body.settlements!.every((s) => s.bill_id === BILL_A)).toBe(true);

    const single = await get(`?bill=${BILL_B}`, CANON_DB);
    expect(single.body).toEqual({
      settlements: [{ bill_id: BILL_B, tx_hash: TX1, status: 'initiated' }],
      count: 1,
    });

    const none = await get('?bill=0x' + 'cc'.repeat(20), CANON_DB);
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ settlements: [], count: 0 });
  });

  it('rejects malformed bill with 400 (empty/absent value never lists all)', async () => {
    for (const q of ['?bill=', '?bill=nothex', '?bill=0x123', '?bill=' + BILL_A.slice(2)]) {
      const r = await get(q, CANON_DB);
      expect(r.status, q).toBe(400);
      expect(r.body.error, q).toContain('0x + 40 hex');
      expect(r.body.settlements).toBeUndefined();
    }
  });

  it('carries NO secrets: no wallet, nullifier or indexer-internal column crosses the wire', async () => {
    const r = await get('', CANON_DB);
    const wire = JSON.stringify(r.body);
    expect(wire.includes('SECRET-NULLIFIER-DO-NOT-LEAK')).toBe(false);
    // 'refunded'/'fully_confirmed' are legal STATUS VALUES; only internal
    // column NAMES and secret material are banned from the wire entirely.
    for (const banned of ['nullifier', 'wallet', 'user_op_hash', 'log_index', 'recorded_at',
      'claimed_count', 'claimed_amount', 'confirmed_at', 'initiated_block',
      'fully_confirmed_at', 'settled_at', 'block', 'settlement_id']) {
      expect(wire.includes(banned), `leaked internal key ${banned}`).toBe(false);
    }
  });

  it('is READ-ONLY: canonical DB file bytes are bit-identical after serving', async () => {
    const before = sha(CANON_DB);
    await get('', CANON_DB);
    await get(`?bill=${BILL_A}`, CANON_DB);
    await get('?bill=nothex', CANON_DB);
    expect(sha(CANON_DB)).toBe(before);
  });

  it('degrades honestly: missing table AND missing file -> [] + count 0 at 200, never an error', async () => {
    for (const dbFile of [NOTABLE_DB, MISSING_DB]) {
      const r = await get('', dbFile);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ settlements: [], count: 0 });
    }
  });
});
