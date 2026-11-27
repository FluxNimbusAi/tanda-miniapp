// C4 SHARE DEEP-LINK (Flux scan item 9): GET /api/bills-for?address=0x… ->
// the public settlement trail of one wallet, the payload behind /bill/[address].
// House posture (settlements/route.ts + seat-grants): READ-ONLY node:sqlite,
// single-writer invariant (Python indexer owns the file), degradation =
// empty list at 200, never an error state. No wallet/nullifier internals
// cross the wire: bill_id, status, amounts, tx hashes only — everything the
// chain already exposes, re-cut for humans.
// HOSTED-LANE NOTE: TANDA_INDEX_DB is the R-44a explicit pin; on Vercel the
// file is absent -> empty state renders honestly ("no indexed trail from
// this device yet"). Address-keyed proxy parity = bill_index.py follow-up
// slice (logged, not faked).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import path from "node:path";

const DEFAULT_DB = () =>
  process.env.TANDA_INDEX_DB ??
  path.resolve(process.cwd(), "..", "tanda-sync", "bill_index.db");

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type Row = {
  bill_id: string;
  amount_units: string | null;
  tx_hash: string | null;
  settled_at: number | null;
  fully_confirmed_at: number | null;
  refunded: number;
};

function statusOf(r: Row): string {
  if (r.refunded) return "refunded";
  if (r.settled_at !== null) return "executed";
  if (r.fully_confirmed_at !== null) return "fully_confirmed";
  return "initiated";
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "address must be 0x + 40 hex" }, { status: 400 });
  }
  const want = address.toLowerCase();
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(DEFAULT_DB(), { readOnly: true });
    // a wallet touches a bill through its seats; seat_grants is the join table
    const rows = db
      .prepare(
        `SELECT s.bill_id, s.amount_units, s.tx_hash, s.settled_at,
                s.fully_confirmed_at, s.refunded
         FROM settlements s
         JOIN seat_grants g ON g.bill_id = s.bill_id
         WHERE lower(g.wallet_address) = ?
         ORDER BY COALESCE(s.settled_at, s.fully_confirmed_at) DESC`,
      )
      .all(want) as Row[];
    db.close();
    const bills = rows.map((r) => ({
      bill_id: r.bill_id,
      status: statusOf(r),
      amount_units: r.amount_units,
      tx_hash: r.tx_hash,
    }));
    return NextResponse.json({ address: want, bills, count: bills.length });
  } catch {
    return NextResponse.json({ address: want, bills: [], count: 0 });
  }
}
