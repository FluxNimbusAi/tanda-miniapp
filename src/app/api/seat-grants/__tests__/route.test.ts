// P0.3 API/UI integration tests (t_44ae186c): drive the real
// /api/seat-grants route against ephemeral node:sqlite fixture DBs, then run
// the response body through the resolver and render the badge via
// react-dom/server — pinning the whole chain from index rows to UI state.
// Runs in the default node env (vitest.config.ts); no jsdom needed because
// the UI leg asserts on server-rendered HTML strings.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

import { resolveSeatVerification, verificationToFlag } from '@/lib/seatVerification';
import { SeatBadgeFromFlag } from '@/components/SeatBadge';

// Same guarded require pattern the route uses: @types/node ^20 has no
// node:sqlite typings and CI runs Node >= 22.5 where the module is present.
const nodeRequire = createRequire(import.meta.url);
type SqliteStmt = { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { exec(sql: string): void; prepare(sql: string): SqliteStmt; close(): void };
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => SqliteDb;
};

const BILL = '0xaabbccddeeff00112233445566778899aabbccd0';
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

type FeedBody = {
  grants?: Record<string, { nullifier?: string }>;
  indexed?: boolean;
  note?: string;
  error?: string;
};

// --- fixtures -------------------------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), 'tanda-seat-'));
const LIVE_DB = path.join(dir, 'live.db');
const NOTABLE_DB = path.join(dir, 'no_table.db');
const MISSING_DB = path.join(dir, 'does-not-exist.db');

{
  const db = new DatabaseSync(LIVE_DB);
  db.exec(
    'CREATE TABLE seat_grants (bill_address TEXT, wallet_address TEXT, nullifier TEXT)',
  );
  // Stored fully uppercased on purpose: proves the route normalises BOTH
  // the query param and the row keys (lower(bill_address) match + toLowerCase
  // grant keys) end to end.
  db.prepare('INSERT INTO seat_grants VALUES (?, ?, ?)').run(
    BILL.toUpperCase(),
    W1.toUpperCase(),
    'nullifier-1',
  );
  db.close();
}
{
  const db = new DatabaseSync(NOTABLE_DB);
  db.exec('CREATE TABLE unrelated (x INTEGER)'); // seat_grants NOT built yet
  db.close();
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Fresh route module instance per call (DEFAULT_DB is a module-load-time
 *  const), pointed at `dbFile` via TANDA_INDEX_DB, then GET `query`. */
async function getRoute(
  dbFile: string,
  query: string,
): Promise<{ status: number; body: FeedBody }> {
  process.env.TANDA_INDEX_DB = dbFile;
  vi.resetModules();
  const { GET } = await import('../route');
  const req = {
    nextUrl: new URL(`http://localhost/api/seat-grants${query}`),
  } as unknown as NextRequest;
  const res = (await GET(req)) as unknown as Response;
  return { status: res.status, body: (await res.json()) as FeedBody };
}

// --- API behaviour ---------------------------------------------------------
describe('GET /api/seat-grants — live index (verified + unverified seats)', () => {
  it('200 + indexed:true, lowercased grant keys, mixed-case row/param still match', async () => {
    const { status, body } = await getRoute(LIVE_DB, `?bill=${BILL.toUpperCase()}`);
    expect(status).toBe(200);
    expect(body.indexed).toBe(true);
    expect(body.grants?.[W1]).toEqual({ nullifier: 'nullifier-1' });
    // keys are emitted lowercase, never the raw uppercase row value
    expect(body.grants?.[W1.toUpperCase()]).toBeUndefined();
  });

  it('feed -> resolver: granted wallet verified, non-granted wallet unverified', async () => {
    const { body } = await getRoute(LIVE_DB, `?bill=${BILL}`);
    expect(resolveSeatVerification(body, W1)).toBe('verified');
    expect(resolveSeatVerification(body, W2)).toBe('unverified');
  });
});

describe('GET /api/seat-grants — missing verification data degrades, never errors', () => {
  it('seat_grants table missing -> 200 { grants:{}, indexed:false, note } -> unknown', async () => {
    const { status, body } = await getRoute(NOTABLE_DB, `?bill=${BILL}`);
    expect(status).toBe(200);
    expect(body.grants).toEqual({});
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('not built');
    expect(resolveSeatVerification(body, W1)).toBe('unknown');
  });

  it('DB file missing -> 200 indexed:false + unavailable note -> unknown', async () => {
    const { status, body } = await getRoute(MISSING_DB, `?bill=${BILL}`);
    expect(status).toBe(200);
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('index db unavailable');
    expect(resolveSeatVerification(body, W2)).toBe('unknown');
  });

  it('invalid or missing bill param -> 400 with error', async () => {
    for (const q of ['?bill=nope', '?bill=0x123', '?bill=' + '0'.repeat(44), '']) {
      const { status, body } = await getRoute(LIVE_DB, q);
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    }
  });
});

// --- full-chain UI integration --------------------------------------------
describe('UI integration — badge renders from API-exposed verification status', () => {
  it('live feed + granted wallet -> verified chip', async () => {
    const { body } = await getRoute(LIVE_DB, `?bill=${BILL}`);
    const flag = verificationToFlag(resolveSeatVerification(body, W1));
    expect(flag).toBe(true);
    const html = renderToString(createElement(SeatBadgeFromFlag, { verified: flag }));
    expect(html).toContain('data-state="verified"');
    expect(html).toContain('World ID verified');
  });

  it('live feed + absent wallet -> unverified chip', async () => {
    const { body } = await getRoute(LIVE_DB, `?bill=${BILL}`);
    const flag = verificationToFlag(resolveSeatVerification(body, W2));
    expect(flag).toBe(false);
    const html = renderToString(createElement(SeatBadgeFromFlag, { verified: flag }));
    expect(html).toContain('data-state="unverified"');
    expect(html).toContain('Not verified');
  });

  it('degraded feed -> neutral unavailable chip (no crash, no blank)', async () => {
    const { body } = await getRoute(NOTABLE_DB, `?bill=${BILL}`);
    const flag = verificationToFlag(resolveSeatVerification(body, W1));
    expect(flag).toBeNull();
    const html = renderToString(createElement(SeatBadgeFromFlag, { verified: flag }));
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain('Verification unavailable');
  });
});
