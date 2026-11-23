// W2.5-5 — same-origin proxy for the MiniKit transaction-status endpoint.
// The client hook polls EXACTLY the contract path
//   GET /api/v2/minikit/transaction/{userOpHash}
// and this route forwards to World's public status API (docs: status ∈
// pending | completed | failed, nested under `transaction`). Chosen shape:
//  - no CORS surprises inside the World App webview;
//  - upstream body forwarded VERBATIM (the hook normalizes both documented
//    shapes — nested worldcoin.org `transaction` and flat userop status);
//  - upstream codes passed through so the poller's budget (not silence)
//    decides eternal pending; transport failure -> 502 (poller keeps
//    polling within budget).
// Server-side env, request-time reads (CI builds with no env):
//   MINIKIT_TX_UPSTREAM_BASE (default https://worldcoin.org/api/v2/minikit/transaction)
//   MINIKIT_APP_ID           (optional ?app_id= passthrough for private apps)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const UPSTREAM_BASE = (
  process.env.MINIKIT_TX_UPSTREAM_BASE ??
  'https://worldcoin.org/api/v2/minikit/transaction'
).replace(/\/+$/, '');

const HEX64 = /^0x[0-9a-fA-F]{40,64}$/; // userOpHash 64-hex; some lanes carry tx 40..64

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  if (!HEX64.test(hash)) {
    return NextResponse.json(
      { error: 'hash must be 0x + 40..64 hex' },
      { status: 400 },
    );
  }
  const appId = process.env.MINIKIT_APP_ID;
  const url =
    `${UPSTREAM_BASE}/${hash}` +
    (appId ? `?app_id=${encodeURIComponent(appId)}` : '');
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const body = await res.json().catch(() => null);
    if (body === null) {
      // non-JSON upstream (portal page, 5xx html): tell the client "unknown"
      // with the same semantics as a miss — pass the code, empty object body.
      return NextResponse.json(
        { error: 'upstream non-json', upstream_status: res.status },
        { status: res.ok ? 502 : res.status },
      );
    }
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'upstream unavailable: ' + (e as Error).message.slice(0, 80) },
      { status: 502 },
    );
  }
}
