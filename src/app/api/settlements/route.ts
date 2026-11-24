// M4-2 P0.1a / issue #19 SR-RV-A1: GET /api/settlements?bill=0x<addr>&page=<n>
// Thin, AUTH-FREE proxy onto the :8096 indexer's canonical read endpoint
// (FluxNimbusAi/tanda services/bill_index.py, SR-003 F12 parity lane). Chosen
// over the seat-grants SQLite-direct pattern because (a) the indexer is the
// audited single writer and truth source (event-topic parity lives there),
// and (b) the M4-1 hosting lane (Vercel) has no filesystem access to the
// index DB. Validation is enforced here too so malformed requests never hit
// the indexer: 400 on malformed bill/page; empty bill -> [] rows (200);
// UGLY-1 (t_b7c72897) "Direct Truth": indexer unavailable now falls back to
// decoding the bill straight from chain state (public RPC, no local state).
// ?source=chain forces the chain path even when the indexer answers. If the
// chain read also fails, degrade to [] rows with indexed:false, never 5xx.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readChainBill } from "@/lib/chainBill";
import type { Address } from "viem";

async function chainBody(bill: string, page: number, why: string) {
  try {
    const c = await readChainBill(bill as Address);
    return NextResponse.json(
      {
        bill,
        page,
        page_size: 20,
        total_settlements: c.settlements.length,
        total_events: c.events.length,
        settlements: c.settlements,
        events: c.events,
        seats: c.seats,
        core: c.core,
        indexed: false,
        source: "chain" as const,
        as_of_block: c.as_of_block,
        note: why,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        bill,
        page,
        page_size: 20,
        total_settlements: 0,
        total_events: 0,
        settlements: [],
        events: [],
        indexed: false,
        note: `indexer unavailable (${why}); chain read failed: ${(e as Error).message.slice(0, 60)}`,
      },
      { status: 200 },
    );
  }
}

const INDEXER = (process.env.BILL_INDEX_URL ?? "http://127.0.0.1:8096").replace(
  /\/+$/,
  "",
);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PAGE_RE = /^[1-9][0-9]*$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bill = (sp.get("bill") ?? "").toLowerCase();
  if (!ADDRESS_RE.test(bill)) {
    return NextResponse.json(
      { error: "bill must be 0x + 40 hex" },
      { status: 400 },
    );
  }
  const pageRaw = sp.get("page") ?? "1";
  if (!PAGE_RE.test(pageRaw)) {
    return NextResponse.json(
      { error: "page must be an integer >= 1" },
      { status: 400 },
    );
  }
  const page = parseInt(pageRaw, 10);
  // UGLY-1 feature flag: source=chain bypasses the indexer entirely.
  if (sp.get("source") === "chain") {
    return chainBody(bill, page, "chain read forced via source=chain");
  }
  const url = `${INDEXER}/api/settlements?bill=${encodeURIComponent(bill)}&page=${pageRaw}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`indexer http ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    // Direct Truth fallback: decode from chain instead of serving empty rows.
    return chainBody(
      bill,
      page,
      "indexer unreachable, answering from chain: " +
        (e as Error).message.slice(0, 40),
    );
  }
}
