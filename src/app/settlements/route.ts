// t_76fdc0c4 / Flux ruling D3 11-19 [SETTLE-READ-ENDPOINT]: client-facing
// GET /settlements — READ-ONLY route over the :8096 canonical indexer DB
// (tanda-sync services/bill_index.py `settlements` summary table).
//
// Contract is pinned test-first by src/app/settlements/__tests__/settlements.
// golden.test.ts: response is EXACTLY { settlements: [{bill_id, seat_ref?,
// amount?, tx_hash?, status}], count }; no indexer-internal columns, no
// wallet/nullifier material ever crosses the wire.
//
// Lane posture: direct readOnly node:sqlite open — same single-writer
// invariant and degradation semantics as /api/seat-grants (the Python
// indexer OWNS this file; this route never writes). Distinct from the
// merged /api/settlements proxy (PR #22): that lane is the bill-scoped,
// paginated canonical payload mirror with REQUIRED bill; this route is the
// client wire shape with OPTIONAL ?bill= listing. Both are read-only views
// onto identical :8096 semantics; coexistence flagged for Flux arbitration.
//
// Degradation (seat-grants posture): missing DB file / missing table ->
// {settlements: [], count: 0} at 200, never an error state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import path from 'node:path';

// Same env + default as /api/seat-grants: the canonical services/bill_index.py
// resolves DB_PATH to <repo>/bill_index.db (parents[1]), i.e. this file.
// Repo-relative default (showroom hygiene: no absolute user paths in public source).
const DEFAULT_DB =
  process.env.TANDA_INDEX_DB ??
  path.resolve(process.cwd(), '..', 'tanda-sync', 'bill_index.db');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type SettlementRow = {
  bill_id: string;
  amount: string | null;
  tx_hash: string;
  settled_at: number | null;
  fully_confirmed_at: number | null;
  refunded: number;
};

// SR-003 F12 lifecycle precedence: refunded > executed > fully_confirmed >
// initiated, derived ONLY from the canonical summary columns.
function statusOf(r: SettlementRow): string {
  if (r.refunded) return 'refunded';
  if (r.settled_at !== null) return 'executed';
  if (r.fully_confirmed_at !== null) return 'fully_confirmed';
  return 'initiated';
}

export async function GET(req: NextRequest) {
  const billParam = req.nextUrl.searchParams.get('bill');
  // Optional filter: absent -> list all. PRESENT-but-malformed (incl. the
  // empty `?bill=`) -> 400 BEFORE any DB touch; never silently lists all.
  let bill: string | null = null;
  if (billParam !== null) {
    bill = billParam.toLowerCase();
    if (!ADDRESS_RE.test(bill)) {
      return NextResponse.json({ error: 'bill must be 0x + 40 hex' }, { status: 400 });
    }
  }

  const empty = { settlements: [], count: 0 };
  try {
    // node:sqlite (Node >= 22.5; CI/dev lane runs Node 26). Guarded dynamic
    // require so unsupported runtimes degrade to empty rows, build stays green.
    const reqMod = createRequire(import.meta.url);
    const { DatabaseSync } = reqMod('node:sqlite');
    const db = new DatabaseSync(DEFAULT_DB, { readOnly: true });
    try {
      // Explicit column list only — SELECT * could ever leak internal cols.
      // CAST(total_amount AS TEXT): int64 amounts (e.g. > 2^53) must never
      // transit float64. lower(): bill/tx identity keys normalized like
      // seat-grants. settlement_id orders rows but never crosses the wire.
      const rows = (
        bill === null
          ? db
              .prepare(
                'SELECT lower(bill_id) AS bill_id, CAST(total_amount AS TEXT) AS amount,' +
                  ' lower(tx_hash) AS tx_hash, settled_at, fully_confirmed_at, refunded' +
                  ' FROM settlements ORDER BY lower(bill_id), settlement_id',
              )
              .all()
          : db
              .prepare(
                'SELECT lower(bill_id) AS bill_id, CAST(total_amount AS TEXT) AS amount,' +
                  ' lower(tx_hash) AS tx_hash, settled_at, fully_confirmed_at, refunded' +
                  ' FROM settlements WHERE lower(bill_id) = ?' +
                  ' ORDER BY lower(bill_id), settlement_id',
              )
              .all(bill)
      ) as unknown as SettlementRow[];
      const settlements = rows.map((r) => {
        const row: Record<string, string> = {
          bill_id: r.bill_id,
          tx_hash: r.tx_hash,
          status: statusOf(r),
        };
        if (r.amount !== null) row.amount = r.amount;
        // seat_ref has no per-settlement source in the canonical summary
        // table (seat identity lives in settlement_events); contract keeps
        // the key optional and this lane never fabricates it.
        return row;
      });
      return NextResponse.json({ settlements, count: settlements.length });
    } catch {
      // settlements table not built yet (or unreadable) -> empty, 200.
      return NextResponse.json(empty);
    } finally {
      db.close();
    }
  } catch {
    // DB file missing / sqlite unavailable -> honest empty, never an error.
    return NextResponse.json(empty);
  }
}
