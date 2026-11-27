// KAIZEN-5 (t_86b44100): GET /api/claims?address=0x<wallet> — the wallet's
// unclaimed pull-claim pool across ALL indexed bills. House posture = the
// seat-grants pattern: READ-ONLY node:sqlite view onto the indexer DB (the
// Python indexer is the single writer, audit correction #4); missing table or
// DB degrades to an empty 200, never 5xx. This route NEVER writes.
//
// Membership math (recon lock):
//   claimable = seat_grants row for (bill, wallet)
//             AND settlements row settled_at NOT NULL, refunded = 0,
//                 pool (total_amount - claimed_amount) > 0
//             AND NO seat_claims row for (bill, settlement, wallet).
// The emitted figure is the BILL-LEVEL unclaimed pool only — per-seat payout
// is never fabricated from the partial index (claimablePayout is chain-side).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import path from "node:path";

// DB default resolved repo-relative (showroom hygiene: no absolute user paths
// in public source); dev-lane layout: sibling checkout ../tanda-sync/bill_index.db.
const DEFAULT_DB =
  process.env.TANDA_INDEX_DB ??
  path.resolve(process.cwd(), "..", "tanda-sync", "bill_index.db");

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: "address must be 0x + 40 hex" },
      { status: 400 },
    );
  }

  try {
    // node:sqlite (Node >= 22.5; dev-lane Node 26). Dynamic require so older
    // runtimes degrade instead of failing the build.
    const reqMod = createRequire(import.meta.url);
    const { DatabaseSync } = reqMod("node:sqlite");
    const db = new DatabaseSync(DEFAULT_DB, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT s.bill_id AS bill,
                  s.settlement_id AS settlement_id,
                  (s.total_amount - s.claimed_amount) AS unclaimed_units,
                  s.settled_at AS settled_at
           FROM settlements s
           WHERE s.refunded = 0
             AND s.settled_at IS NOT NULL
             AND (s.total_amount - s.claimed_amount) > 0
             AND EXISTS (
               SELECT 1 FROM seat_grants g
               WHERE lower(g.bill_address) = lower(s.bill_id)
                 AND lower(g.wallet_address) = ?)
             AND NOT EXISTS (
               SELECT 1 FROM seat_claims c
               WHERE lower(c.bill_id) = lower(s.bill_id)
                 AND c.settlement_id = s.settlement_id
                 AND lower(c.wallet) = ?)
           ORDER BY s.bill_id, s.settlement_id`,
        )
        .all(address, address) as {
        bill: string;
        settlement_id: number;
        unclaimed_units: number;
        settled_at: number | null;
      }[];
      const claims = rows.map((r) => ({
        bill: String(r.bill).toLowerCase(),
        settlement_id: r.settlement_id,
        unclaimed_units: r.unclaimed_units,
        settled_at: r.settled_at,
      }));
      const total = claims.reduce((a, c) => a + c.unclaimed_units, 0);
      return NextResponse.json({
        address,
        claims,
        count: claims.length,
        // distinct bills with >=1 claimable settlement (H4 pileup counter)
        bill_count: new Set(claims.map((c) => c.bill)).size,
        total_unclaimed_units: total,
        indexed: true,
      });
    } catch {
      return NextResponse.json({
        address,
        claims: [],
        count: 0,
        bill_count: 0,
        total_unclaimed_units: 0,
        indexed: false,
        note: "settlements/seat_claims index not built yet",
      });
    } finally {
      db.close();
    }
  } catch (e) {
    return NextResponse.json({
      address,
      claims: [],
      count: 0,
      bill_count: 0,
      total_unclaimed_units: 0,
      indexed: false,
      note: "index db unavailable: " + (e as Error).message.slice(0, 80),
    });
  }
}
