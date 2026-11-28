// W2.5-3 (t_14b21fee): thin AUTH-FREE proxy onto the :8096 indexer /health,
// powering the browser Live Explorer status strip. Same posture as
// /api/settlements (M4-2 #22): validation-free read, indexer unavailable
// degrades to {indexed:false} at 200 — the Explorer never sees an error state.
//
// KAIZEN-8 (t_59d90ce4) LAST-KNOWN-GOOD: from the public (Vercel) deploy the
// indexer is loopback-only, so an unreachable /health used to print
// indexer:offline to EVERY visitor. The warm instance now remembers the last
// HEALTHY snapshot and replays it tagged {indexed:false, source:'cache',
// stale:true, as_of} on upstream failure; the Explorer renders it timestamped
// instead of offline. Self-hosted lanes with BILL_INDEX_URL pointing at a
// reachable indexer refresh the live path exactly as before — zero behavior
// change when healthy. A reachable-but-degraded /health (status != 'ok') is
// an honest passthrough, never masked by the cache.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const INDEXER = (process.env.BILL_INDEX_URL ?? 'http://127.0.0.1:8096').replace(
  /\/+$/,
  '',
);

// Module-level last-known-good. Serverless instances are ephemeral, so this is
// only ONE rung: the Explorer browser snapshot covers cold instances. Never a
// standalone freshness claim — every replay is tagged + timestamped.
let lkg: { body: Record<string, unknown>; asOf: number } | null = null;

function cachedResponse(good: { body: Record<string, unknown>; asOf: number }) {
  return NextResponse.json(
    {
      ...good.body,
      indexed: false,
      source: 'cache' as const,
      stale: true,
      as_of: good.asOf,
      note: 'indexer unreachable; showing last-known-good',
    },
    { status: 200 },
  );
}

export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(`${INDEXER}/health`, { cache: 'no-store' });
    if (!res.ok) {
      const dead = { indexed: false, note: `indexer http ${res.status}` };
      return lkg ? cachedResponse(lkg) : NextResponse.json(dead, { status: 200 });
    }
    const body = (await res.json()) as Record<string, unknown>;
    const indexed = body.status === 'ok';
    if (indexed) {
      lkg = { body, asOf: nowSec };
      return NextResponse.json(
        { ...body, indexed: true, source: 'live' as const, as_of: nowSec },
        { status: 200 },
      );
    }
    // Reachable but degraded: the indexer IS answering, so its state is the
    // truth — passthrough, no cache replay (see header contract note).
    return NextResponse.json({ ...body, indexed: false }, { status: 200 });
  } catch (e) {
    const dead = {
      indexed: false,
      note: 'indexer unavailable: ' + (e as Error).message.slice(0, 80),
    };
    return lkg ? cachedResponse(lkg) : NextResponse.json(dead, { status: 200 });
  }
}
