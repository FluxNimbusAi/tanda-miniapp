// KAIZEN-5 goldens (t_86b44100): drive the real /api/claims route against
// ephemeral node:sqlite fixture DBs (same getRoute pattern as seat-grants:
// DEFAULT_DB is a module-load const, so set TANDA_INDEX_DB + vi.resetModules
// + dynamic import per fixture). Pins the membership math end to end:
// grant AND settled AND pool>0 AND NOT already-claimed AND NOT refunded.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

const nodeRequire = createRequire(import.meta.url);
type SqliteStmt = { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { exec(sql: string): void; prepare(sql: string): SqliteStmt; close(): void };
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => SqliteDb;
};

const B1 = '0x11111111111111111111111111111111111111b1';
const B2 = '0x22222222222222222222222222222222222222b2';
const B3 = '0x33333333333333333333333333333333333333b3';
const B4 = '0x44444444444444444444444444444444444444b4';
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

type Body = {
  claims?: {
    bill: string;
    settlement_id: number;
    unclaimed_units: number;
    settled_at: number | null;
  }[];
  count?: number;
  bill_count?: number;
  total_unclaimed_units?: number;
  indexed?: boolean;
  note?: string;
  error?: string;
};

const dir = mkdtempSync(path.join(tmpdir(), 'tanda-claims-'));
const LIVE_DB = path.join(dir, 'live.db');
const NOTABLE_DB = path.join(dir, 'no_table.db');
const MISSING_DB = path.join(dir, 'does-not-exist.db');

{
  const db = new DatabaseSync(LIVE_DB);
  db.exec(`CREATE TABLE settlements (bill_id TEXT, settlement_id INT,
    total_amount INT, claimed_amount INT, settled_at INT, refunded INT)`);
  db.exec(`CREATE TABLE seat_grants (bill_address TEXT, wallet_address TEXT)`);
  db.exec(`CREATE TABLE seat_claims (bill_id TEXT, settlement_id INT, wallet TEXT)`);
  const s = db.prepare(
    'INSERT INTO settlements VALUES (?, ?, ?, ?, ?, ?)',
  );
  // B1 s0: settled, pool 10000, W1 granted, W1 also claimed -> EXCLUDED for W1
  s.run(B1, 0, 20000, 10000, 1795106234, 0);
  // B2 s0: settled, pool 20000, fully claimed by nobody -> W1 CLAIMABLE
  s.run(B2, 0, 20000, 0, 1795106234, 0);
  // B2 s1: zero pool -> never listed for anyone
  s.run(B2, 1, 10000, 10000, 1795106234, 0);
  // B3 s0: refunded -> excluded
  s.run(B3, 0, 30000, 0, 1795106234, 1);
  // B4 s0: settled_at NULL (not settled yet) -> excluded
  s.run(B4, 0, 40000, 0, null, 0);
  const g = db.prepare('INSERT INTO seat_grants VALUES (?, ?)');
  // stored uppercase on purpose: proves row-side normalisation
  g.run(B1.toUpperCase(), W1);
  g.run(B2, W1);
  g.run(B3, W1);
  g.run(B4, W1);
  g.run(B2, W2);
  const c = db.prepare('INSERT INTO seat_claims VALUES (?, ?, ?)');
  c.run(B1, 0, W1);
  db.close();
}
{
  const db = new DatabaseSync(NOTABLE_DB);
  db.exec('CREATE TABLE unrelated (x INTEGER)');
  db.close();
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function getRoute(dbFile: string, query: string) {
  process.env.TANDA_INDEX_DB = dbFile;
  vi.resetModules();
  const { GET } = await import('../route');
  const req = {
    nextUrl: new URL(`http://localhost/api/claims${query}`),
  } as unknown as NextRequest;
  const res = (await GET(req)) as unknown as Response;
  return { status: res.status, body: (await res.json()) as Body };
}

describe('GET /api/claims — membership math (grant ∧ settled ∧ pool>0 ∧ ¬claimed ∧ ¬refunded)', () => {
  it('W1: only B2 s0 survives every filter; keys lowercase; totals honest', async () => {
    const { status, body } = await getRoute(LIVE_DB, `?address=${W1}`);
    expect(status).toBe(200);
    expect(body.indexed).toBe(true);
    expect(body.claims).toEqual([
      { bill: B2, settlement_id: 0, unclaimed_units: 20000, settled_at: 1795106234 },
    ]);
    expect(body.count).toBe(1);
    expect(body.bill_count).toBe(1);
    expect(body.total_unclaimed_units).toBe(20000);
  });

  it('W2 (granted B2, never claimed) sees B2 s0; uppercase param still matches', async () => {
    const { body } = await getRoute(LIVE_DB, `?address=${W2.toUpperCase()}`);
    expect(body.claims?.map((x) => x.bill)).toEqual([B2]);
  });

  it('wallet with no grants anywhere -> empty 200', async () => {
    const { status, body } = await getRoute(
      LIVE_DB,
      '?address=0x9999999999999999999999999999999999999999',
    );
    expect(status).toBe(200);
    expect(body.claims).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('multi-bill sweep shape: pools sum across claims (H4 counter)', async () => {
    const MULTI_DB = path.join(dir, 'multi.db');
    const d = new DatabaseSync(MULTI_DB);
    d.exec(`CREATE TABLE settlements (bill_id TEXT, settlement_id INT,
      total_amount INT, claimed_amount INT, settled_at INT, refunded INT)`);
    d.exec(`CREATE TABLE seat_grants (bill_address TEXT, wallet_address TEXT)`);
    d.exec(`CREATE TABLE seat_claims (bill_id TEXT, settlement_id INT, wallet TEXT)`);
    d.prepare('INSERT INTO settlements VALUES (?, ?, ?, ?, ?, ?)').run(
      B2, 0, 20000, 0, 1795106234, 0);
    d.prepare('INSERT INTO settlements VALUES (?, ?, ?, ?, ?, ?)').run(
      B1, 0, 10000, 0, 1795106234, 0);
    d.prepare('INSERT INTO seat_grants VALUES (?, ?)').run(B1, W2);
    d.prepare('INSERT INTO seat_grants VALUES (?, ?)').run(B2, W2);
    d.close();
    const { body } = await getRoute(MULTI_DB, `?address=${W2}`);
    expect(body.bill_count).toBe(2);
    expect(body.total_unclaimed_units).toBe(30000);
    // ORDER BY bill, settlement — B1 before B2 regardless of insert order
    expect(body.claims?.map((x) => [x.bill, x.settlement_id])).toEqual([
      [B1, 0],
      [B2, 0],
    ]);
  });
});

describe('GET /api/claims — degrade paths never error', () => {
  it('tables missing -> 200 indexed:false + not-built note', async () => {
    const { status, body } = await getRoute(NOTABLE_DB, `?address=${W1}`);
    expect(status).toBe(200);
    expect(body.claims).toEqual([]);
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('not built');
  });

  it('DB file missing -> 200 indexed:false + unavailable note', async () => {
    const { status, body } = await getRoute(MISSING_DB, `?address=${W1}`);
    expect(status).toBe(200);
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('index db unavailable');
  });

  it('malformed / missing address -> 400', async () => {
    for (const q of ['?address=nope', '?address=0x123', '?address=', '']) {
      const { status, body } = await getRoute(LIVE_DB, q);
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    }
  });
});
