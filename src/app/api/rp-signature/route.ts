import { timingSafeEqual } from 'node:crypto';

import { auth } from '@/auth';
import { signRequest } from '@worldcoin/idkit/signing';
import { NextResponse } from 'next/server';

import { PORTAL_RP_ID } from '@/lib/portalAnchors';
import {
  BILL_RP_ACTIONS,
  isBillRpAction,
  recordRpDeny,
  recordRpSign,
} from '@/lib/rpSignatureGuard';

export const runtime = 'nodejs';

// SR-002-A3 (P1) will require RP_ID/RP_SIGNING_KEY strictly from env and
// fail loudly; the default is preserved here so this PR changes exactly one
// behavior: the action gate. Env reads are request-time, matching the CI
// invariant documented in .github/workflows/ci.yml.
//
// PORTAL-RECON (t_70306450, Flux ruling 4): default flipped from
// rp_e87d44dbb7b76d91 (no portal record) to the portal-recorded anchor.
// Single source @/lib/portalAnchors — never re-literal this value.
const DEFAULT_RP_ID = PORTAL_RP_ID;

// C1 (Flux COMMAND 57839, signing-oracle close): the action enum was the ONLY
// gate — 12/12 unauthenticated POSTs minted live signatures on production.
// Same house auth law as /api/notify (session OR internal bearer), separate
// key by least-privilege. RP_INTERNAL_KEY unset = fail-closed (503), never
// "no key configured means allow all".
async function authorize(req: Request): Promise<'session' | 'internal' | null> {
  const internalKey = process.env.RP_INTERNAL_KEY;
  const bearer = req.headers.get('authorization') ?? '';
  if (internalKey) {
    const got = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
    const a = Buffer.from(got), b = Buffer.from(internalKey);
    if (a.length === b.length && timingSafeEqual(a, b)) return 'internal';
  }
  try {
    const session = await auth();
    if (session?.user?.walletAddress) return 'session';
  } catch {
    /* fall through to 401 */
  }
  return null;
}

// C1 limiter: in-memory sliding window per IP (dev-lane parity with notify's
// dedupe-map pattern). Edge-instance reset on cold start is acceptable while
// the auth gate is the real wall; DB-backed counters at scale = logged backlog.
const WINDOW_MS = 60_000;
const LIMIT = 20;
const hits = new Map<string, number[]>();
/** Test seam: clears sliding-window state between suites. Not for runtime use. */
export function __resetRpRateLimitForTesting(): void {
  hits.clear();
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > LIMIT;
}

// C2 (voided-anchor coercion): production env carries rp_a779c304e4f624ce,
// an id VOIDED by ADR-0011/0012 — the env layer overrode a correct code
// default. A-voided (blocklist) keeps unknown/test anchors usable while
// making DEAD ids runtime-unreachable: they coerce to canonical + warn.
const VOIDED_RP_IDS = new Set(['rp_a779c304e4f624ce', 'rp_e87d44dbb7b76d91']);
function resolveRpId(): string {
  const env = process.env.RP_ID;
  if (env && VOIDED_RP_IDS.has(env)) {
    console.warn(`rp-signature: env RP_ID ${env} is VOIDED per ADR-0012; coercing to canonical ${PORTAL_RP_ID}`);
    return PORTAL_RP_ID;
  }
  return env ?? DEFAULT_RP_ID;
}

/**
 * W2-F2: server-side action allowlist. This endpoint holds the RP signing
 * key — it must sign ONLY the TandaBill protocol actions (`bill:confirm`,
 * `bill:execute`, `bill:rotate`, `tanda_bill_settlement`). Anything else is
 * a 4xx with a logged + counted rejection (Harley SR-002 finding F2: the old
 * route signed ANY string → open signing oracle). ACTION-FLIP (t_7f0f9775,
 * Flux ruling 19:0x after live portal read): the portal-registered name
 * `tanda_bill_settlement` joined the frozen enum; legacy `bill:confirm` is
 * KEPT accepted for the transition window (dual-accept, no removal).
 */
export async function POST(req: Request) {
  const signingKey = process.env.RP_SIGNING_KEY;
  const rpId = resolveRpId();

  if (!process.env.RP_INTERNAL_KEY) {
    return NextResponse.json(
      { error: 'RP_INTERNAL_KEY not configured - signing endpoint fail-closed' },
      { status: 503 },
    );
  }
  if (!(await authorize(req))) {
    recordRpDeny('unauthenticated', undefined);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    recordRpDeny('rate_limited', undefined);
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  if (!signingKey) {
    return NextResponse.json(
      { error: 'RP_SIGNING_KEY not configured' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    recordRpDeny('malformed_body', undefined);
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const action =
    typeof body === 'object' && body !== null
      ? (body as { action?: unknown }).action
      : undefined;

  if (typeof action !== 'string' || action.length === 0) {
    recordRpDeny('missing_or_nonstring_action', action);
    return NextResponse.json(
      { error: 'action must be a non-empty string' },
      { status: 400 },
    );
  }

  if (!isBillRpAction(action)) {
    recordRpDeny('offlist_action', action);
    return NextResponse.json(
      { error: 'action not allowed', allowed: BILL_RP_ACTIONS },
      { status: 403 },
    );
  }

  const sig = signRequest({ action, signingKeyHex: signingKey });
  recordRpSign();

  return NextResponse.json({
    rp_id: rpId,
    sig: sig.sig,
    nonce: sig.nonce,
    created_at: Number(sig.createdAt),
    expires_at: Number(sig.expiresAt),
  });
}
