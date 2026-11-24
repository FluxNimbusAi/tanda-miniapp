// UGLY-2 part (c) PRE-BUILD (t_5d8189f1): verify-route skeleton.
// The action string below is AGREED with gate (a) — registration must create
// `seat-gate-v1` on app app_72a8b9… before this route can answer. Until then
// every path returns 501 with the exact pending reason; no faked success.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const APP_ID = process.env.WORLD_APP_ID ?? ''; // never hard-coded (showroom hygiene)
const ACTION = 'seat-gate-v1';

type VerifyReq = {
  nullifier_hash: string;
  merkle_root: string;
  proof: string;
  signal?: string; // expected "0x<bill>:0x<wallet>" binding (contract records keccak)
};

/** Verify a World ID proof against the SEAT-GATE action (portal API v3). */
async function worldIdVerify(body: VerifyReq): Promise<{ valid: boolean; detail: string }> {
  if (!APP_ID) return { valid: false, detail: 'WORLD_APP_ID not configured (gate a)' };
  const secret = process.env.WORLD_APP_SECRET ?? '';
  if (!secret) return { valid: false, detail: 'WORLD_APP_SECRET not configured (gate a)' };
  const res = await fetch('https://developer.worldcoin.org/api/v3/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, action: ACTION, app_id: APP_ID, action_id: secret }),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    valid: Boolean(j.success) || Number(j.verified_consume) >= 1 || j.nullifier_hash === body.nullifier_hash && res.ok && j.success !== false,
    detail: JSON.stringify(j).slice(0, 160),
  };
}

/** Register a verified human as a seat: verify proof -> registerSeat calldata via
 *  MiniKit userop (bill contract executes registerSeat(nullifier, wallet, signal)). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as (VerifyReq & { bill?: string; wallet?: string }) | null;
  if (!body || !body.nullifier_hash || !body.merkle_root || !body.proof || !body.bill || !body.wallet) {
    return NextResponse.json({ error: 'nullifier_hash, merkle_root, proof, bill, wallet required' }, { status: 400 });
  }
  const signal = body.signal ?? `${body.bill.toLowerCase()}:${body.wallet.toLowerCase()}`;
  const v = await worldIdVerify({ ...body, signal });
  if (!v.valid) {
    // 501 while gate (a) unconfigured vs 403 when a real proof fails: honest split
    const pending = v.detail.includes('gate a');
    return NextResponse.json(
      { error: pending ? 'seat action not yet registered (UGLY-2a gate)' : 'proof rejected', detail: v.detail },
      { status: pending ? 501 : 403 },
    );
  }
  // Verified: return the exact calldata the client submits through MiniKit's
  // signing lane; the CONTRACT (PR #182) is what burns the nullifier — the
  // server never holds signing power (custody doctrine, Ugly 3).
  return NextResponse.json({
    ok: true,
    action: ACTION,
    bill: body.bill,
    wallet: body.wallet,
    nullifier_hash: body.nullifier_hash,
    signal,
    // registerSeat(bytes32,address,bytes) selector 0x… + abi-encoded args,
    // sent to the bill address via MiniKit sendAction (single choke point).
    calldata: buildRegisterSeatCalldata(body.nullifier_hash, body.wallet, signal),
  });
}

function buildRegisterSeatCalldata(nullifier: string, wallet: string, signal: string): string {
  // Kept dependency-light: viem encodes client-side already (TandaBill.tsx
  // uses the same lib); server returns parts, client assembles via encodeFunctionData.
  return JSON.stringify({ fn: 'registerSeat', nullifier, wallet, signal });
}
