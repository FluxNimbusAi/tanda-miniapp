// W2.5-5 — INDEXED oracle: the one URL the hook (and the P-A runner) poll
// to prove the :8096 bill indexer has landed a mined tx. Composes two
// auth-free indexer lanes (posture precedent: /api/settlements, t_m4_p01a):
//   1. GET :8096 /bills/by-userop/{h}  — canonical BillCreated lane; the
//      GET itself lazy-kicks resolve_userop server-side (W8 design).
//   2. GET :8096 /settlements/{bill}   — settlement_events ledger. Used
//      when the by-userop row says no_event (bill-scoped ops like
//      confirm/initiate/fund carry no BillCreated) and the caller supplied
//      ?tx= (from the relayer's completed poll) + ?bill=. A matching
//      event tx_hash IS the indexed proof for that class.
// Status vocabulary returned to the client (normalizeIndexProbe consumer):
//   success | pending | failed | timeout | error | no_event | absent
// Indexer unreachable -> 200 {status:'absent'} — never a 5xx into the UI
// poll loop: the indexed budget turns silence into the named defect.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const INDEXER = (
  process.env.BILL_INDEX_URL ?? 'http://127.0.0.1:8096'
).replace(/\/+$/, '');

const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

type IndexerRow = Record<string, unknown> & { status?: string };
type BillEvents = { events?: { tx_hash?: string }[] };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  const h = hash.toLowerCase();
  if (!HEX64.test(h)) {
    return NextResponse.json(
      { error: 'user_op_hash must be 0x + 64 hex' },
      { status: 400 },
    );
  }
  const sp = req.nextUrl.searchParams;
  const tx = (sp.get('tx') ?? '').toLowerCase();
  const bill = (sp.get('bill') ?? '').toLowerCase();
  const haveEventsLane = HEX64.test(tx) && ADDR_RE.test(bill);

  // Lane 2 EXCLUSIVELY when we know tx+bill (bill-scoped ops: confirm /
  // initiate / execute / refund / rotate): settlement_events membership is
  // the only indexed truth for those classes. We must NOT fall through to
  // lane 1 here — its BillCreated-decode would answer `no_event` seconds
  // before the 5s scan pass lands the actual event, and no_event terminates
  // the lifecycle (indexedNa). Pending is the honest answer until the
  // ledger shows the tx; the indexed budget turns a real stall into a named
  // defect instead.
  if (haveEventsLane) {
    try {
      const res = await fetch(`${INDEXER}/settlements/${bill}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as BillEvents | null;
        const hit = (body?.events ?? []).some(
          (e) => String(e.tx_hash ?? '').toLowerCase() === tx,
        );
        if (hit) {
          return NextResponse.json({
            user_op_hash: h,
            status: 'success',
            tx_hash: tx,
            bill_address: bill,
            via: 'settlement_events',
          });
        }
      }
      return NextResponse.json({
        user_op_hash: h,
        status: 'pending',
        via: 'settlement_events_absent',
      });
    } catch (e) {
      return NextResponse.json(
        {
          user_op_hash: h,
          status: 'absent',
          indexed: false,
          note: 'indexer unavailable: ' + (e as Error).message.slice(0, 80),
        },
        { status: 200 },
      );
    }
  }

  // Lane 1: canonical by-userop row (kicks the indexer's own resolver).
  try {
    const res = await fetch(`${INDEXER}/bills/by-userop/${h}`, {
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as IndexerRow | null;
    if (!res.ok || body === null) {
      return NextResponse.json(
        { user_op_hash: h, status: 'absent', indexed: false },
        { status: 200 },
      );
    }
    const out: IndexerRow = { ...body, user_op_hash: h };
    if (!out.status) out.status = 'pending';
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      {
        user_op_hash: h,
        status: 'absent',
        indexed: false,
        note: 'indexer unavailable: ' + (e as Error).message.slice(0, 80),
      },
      { status: 200 },
    );
  }
}
