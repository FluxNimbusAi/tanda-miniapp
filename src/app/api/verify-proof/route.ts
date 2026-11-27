import type { IDKitResult } from '@worldcoin/idkit';
import { keccak256, toBytes } from 'viem';
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Forwards the IDKit result as-is to the Developer Portal v4 verify API, then
 * (W10 P1.1) records the proof in the indexer ledger: idkit_verifications +
 * seat_grants. Cryptographic binding enforced BEFORE any grant write
 * (audit correction #2): signal must equal `${bill}:${wallet}` and the proof's
 * signal_hash must equal keccak256(signal). Ledger writes go through the
 * Python indexer (single-writer invariant, correction #4) — this process never
 * touches bill_index.db for writes.
 * @see https://docs.world.org/world-id/idkit/integrate#step-5-verify-the-proof-in-your-backend
 */
const INDEXER = process.env.BILL_INDEX_URL ?? 'http://127.0.0.1:8096';
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function writeKey(): string | null {
  if (process.env.INDEX_WRITE_KEY) return process.env.INDEX_WRITE_KEY;
  const p = path.join(homedir(), '.hermes-secrets', 'index_write_key.txt');
  try {
    return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const expectedRpId = process.env.RP_ID;
  if (!expectedRpId) {
    return NextResponse.json(
      { error: 'RP_ID not configured' },
      { status: 500 },
    );
  }

  const { rp_id, idkitResponse, bill, wallet } = (await req.json()) as {
    rp_id?: string;
    idkitResponse?: IDKitResult;
    bill?: string;
    wallet?: string;
  };

  if (rp_id !== expectedRpId) {
    return NextResponse.json({ error: 'Invalid rp_id' }, { status: 400 });
  }

  if (!idkitResponse) {
    return NextResponse.json(
      { error: 'idkitResponse is required' },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://developer.world.org/api/v4/verify/${encodeURIComponent(expectedRpId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(idkitResponse),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: 'Verification failed', detail },
      { status: 400 },
    );
  }

  // Grant leg only when the caller supplies seat-join context (bill + wallet).
  if (!bill || !wallet) {
    return NextResponse.json({ success: true, granted: false, note: 'no seat context' });
  }
  if (!ADDR_RE.test(bill) || !ADDR_RE.test(wallet)) {
    return NextResponse.json({ success: false, error: 'bad bill/wallet address' }, { status: 400 });
  }

  const p = idkitResponse as unknown as {
    nonce?: string;
    action?: string;
    protocol_version?: string;
    responses?: { nullifier?: string; signal_hash?: string }[];
  };
  const r0 = p.responses?.[0];
  if (!p.nonce || !r0?.nullifier) {
    return NextResponse.json({
      success: true, granted: false,
      note: 'proof payload lacks nonce/nullifier — not ledgered',
    });
  }

  // Cryptographic signal binding (correction #2): the proof must be FOR this seat.
  const billL = bill.toLowerCase();
  const walletL = wallet.toLowerCase();
  const signal = `${billL}:${walletL}`;
  const expectedHash = keccak256(toBytes(signal));
  if ((r0.signal_hash ?? '0x0').toLowerCase() !== expectedHash.toLowerCase()) {
    return NextResponse.json(
      { success: false, error: 'signal_mismatch: proof not bound to this bill:wallet' },
      { status: 400 },
    );
  }

  const key = writeKey();
  if (!key) {
    return NextResponse.json({
      success: true, granted: false,
      note: 'INDEX_WRITE_KEY unavailable — verification passed, ledger write skipped',
    });
  }

  try {
    const res = await fetch(`${INDEXER}/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        rp_id,
        nonce: p.nonce,
        nullifier: r0.nullifier,
        signal_hash: r0.signal_hash,
        action: p.action ?? '',
        protocol_version: p.protocol_version ?? '',
        bill_address: billL,
        wallet_address: walletL,
        signal,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200 || res.status === 409) {
      return NextResponse.json({ success: true, granted: res.status === 200, indexer: body });
    }
    return NextResponse.json({ success: true, granted: false, indexer: body });
  } catch (e) {
    return NextResponse.json({
      success: true, granted: false,
      note: 'indexer unreachable: ' + (e as Error).message.slice(0, 80),
    });
  }
}
