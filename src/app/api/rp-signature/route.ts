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
  const rpId = process.env.RP_ID ?? DEFAULT_RP_ID;

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
