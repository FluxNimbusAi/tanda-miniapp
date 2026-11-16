// W10 P0.3 badge feed: READ-ONLY view onto the indexer DB's seat_grants table.
// Single-writer invariant (audit correction #4): the Python indexer OWNS this file;
// this route opens read-only via node:sqlite and NEVER writes. Missing table/DB =
// empty grants (UI renders neutral chips) - not an error state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';

const DEFAULT_DB =
  process.env.TANDA_INDEX_DB ??
  'C:\\Users\\dbvis\\agent-bench\\tanda-sync\\bill_index.db';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function GET(req: NextRequest) {
  const bill = (req.nextUrl.searchParams.get('bill') ?? '').toLowerCase();
  if (!ADDRESS_RE.test(bill)) {
    return NextResponse.json({ error: 'bill must be 0x + 40 hex' }, { status: 400 });
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
