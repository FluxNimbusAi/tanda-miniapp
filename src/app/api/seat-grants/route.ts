// W10 P0.3 badge feed: READ-ONLY view onto the indexer DB's seat_grants table.
// Single-writer invariant (audit correction #4): the Python indexer OWNS this file;
// this route opens read-only via node:sqlite and NEVER writes. Missing table/DB =
// empty grants (UI renders neutral chips) - not an error state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import path from 'node:path';

// M4-1a (t_3aed711f, Flux GO 2026-11-20): PROXY-FIRST. When BILL_INDEX_URL is
// set (hosted/Vercel lane), the auth-free indexer read route
// GET ${BILL_INDEX_URL}/api/grants?bill= answers; any failure (unreachable,
// non-200, timeout) falls through to the local read-only SQLite lane below,
// which is the dev-lane default. Write key is NEVER consulted from this side -
// the /api/ lane is auth-free by the SR-RV-A1 posture.
const INDEX_URL = (process.env.BILL_INDEX_URL ?? '').replace(/\/+$/, '');
const PROXY_TIMEOUT_MS = 4000;

// DB default resolved repo-relative (showroom hygiene: no absolute user paths in
// public source); dev-lane layout: sibling checkout ../tanda-sync/bill_index.db.
const DEFAULT_DB =
  process.env.TANDA_INDEX_DB ??
  path.resolve(process.cwd(), '..', 'tanda-sync', 'bill_index.db');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function GET(req: NextRequest) {
  const bill = (req.nextUrl.searchParams.get('bill') ?? '').toLowerCase();
  if (!ADDRESS_RE.test(bill)) {
    return NextResponse.json({ error: 'bill must be 0x + 40 hex' }, { status: 400 });
  }

  if (INDEX_URL) {
    try {
      const r = await fetch(`${INDEX_URL}/api/grants?bill=${encodeURIComponent(bill)}`, {
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (r.ok) {
        const j = (await r.json()) as { grants?: Record<string, { nullifier: string }> };
        const grants: Record<string, { nullifier: string }> = {};
        for (const [w, v] of Object.entries(j.grants ?? {})) grants[w.toLowerCase()] = { nullifier: v.nullifier };
        return NextResponse.json({ grants, indexed: true, via: 'indexer-http' });
      }
    } catch {
      // unreachable/timeout: degrade to the local read-only lane below
    }
  }

  try {
    // node:sqlite (Node >= 22.5; dev-lane Node 26). Dynamic require so older
    // runtimes degrade to empty grants instead of failing the build.
    const reqMod = createRequire(import.meta.url);
    const { DatabaseSync } = reqMod('node:sqlite');
    const db = new DatabaseSync(DEFAULT_DB, { readOnly: true });
    try {
      const rows = db
        .prepare(
          'SELECT wallet_address, nullifier FROM seat_grants WHERE lower(bill_address) = ?',
        )
        .all(bill) as { wallet_address: string; nullifier: string }[];
      const grants: Record<string, { nullifier: string }> = {};
      for (const r of rows) grants[r.wallet_address.toLowerCase()] = { nullifier: r.nullifier };
      return NextResponse.json({ grants, indexed: true });
    } catch {
      return NextResponse.json({ grants: {}, indexed: false, note: 'seat_grants table not built yet (slice 3)' });
    } finally {
      db.close();
    }
  } catch (e) {
    return NextResponse.json({
      grants: {},
      indexed: false,
      note: 'index db unavailable: ' + (e as Error).message.slice(0, 80),
    });
  }
}
