// W2.5-3 (t_14b21fee): thin AUTH-FREE proxy onto the :8096 indexer /health,
// powering the browser Live Explorer status strip. Same posture as
// /api/settlements (M4-2 #22): validation-free read, indexer unavailable
// degrades to {indexed:false} at 200 — the Explorer never sees an error state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const INDEXER = (process.env.BILL_INDEX_URL ?? 'http://127.0.0.1:8096').replace(
  /\/+$/,
  '',
);

export async function GET() {
  try {
    const res = await fetch(`${INDEXER}/health`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(
        { indexed: false, note: `indexer http ${res.status}` },
        { status: 200 },
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(
      { ...body, indexed: body.status === 'ok' },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { indexed: false, note: 'indexer unavailable: ' + (e as Error).message.slice(0, 80) },
      { status: 200 },
    );
  }
}
