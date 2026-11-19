// W2-F1 (t_92a43849) real seat join — pure helpers shared by the Verify client
// component and its golden tests. NO DOM/network/IDKit deps so the join leg can
// be pinned in the node env exactly like lib/seatVerification.
//
// Signal contract, FROZEN with the verify-proof route (W10 P1.1): the proof's
// responses[0].signal_hash must equal keccak256(utf8(`${billL}:${walletL}`))
// where BOTH addresses are fully lowercased (server recomputes from the POSTed
// bill+wallet legs, ADDR_RE = /^0x[a-fA-F0-9]{40}$/). An invalid pair must
// never reach IDKit — the proof could not be granted, and a wasted single-use
// nonce burns nothing but user trust.
import { keccak256, toBytes } from 'viem';

/** Registered RP action for seat joins. One action for all bills by design:
 *  the nullifier is deterministic per (rp_id, action), and the indexer's
 *  seat_grants PK (bill_address, nullifier) allows the same human to join
 *  many bills — per-bill dynamic actions would explode portal registration. */
export const SEAT_JOIN_ACTION = 'seat-join';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Trim + full lowercase (also normalizes a 0X prefix) or null.
 *  Mirrors the server's ADDR_RE so client and server agree on acceptance. */
export function normalizeAddress(a: string | null | undefined): string | null {
  if (typeof a !== 'string') return null;
  const s = a.trim().toLowerCase();
  return ADDRESS_RE.test(s) ? s : null;
}

/** `${billL}:${walletL}` or null when either side is not a valid address. */
export function seatJoinSignal(
  bill: string | null | undefined,
  wallet: string | null | undefined,
): string | null {
  const b = normalizeAddress(bill);
  const w = normalizeAddress(wallet);
  if (b === null || w === null) return null;
  return `${b}:${w}`;
}

/** Client-side mirror of the server's binding check (viem keccak256 over the
 *  utf8 bytes — the identical call verify-proof makes before any grant write). */
export function seatJoinSignalHash(signal: string): `0x${string}` {
  return keccak256(toBytes(signal));
}

/** Exact POST /api/verify-proof body for the seat join leg. bill/wallet MUST
 *  already be normalized (normalizeAddress) — the server lowercases again but
 *  the golden pins what crosses the wire. */
export function buildSeatVerifyProofBody(args: {
  rp_id: string;
  idkitResponse: unknown;
  bill: string;
  wallet: string;
}): { rp_id: string; idkitResponse: unknown; bill: string; wallet: string } {
  return {
    rp_id: args.rp_id,
    idkitResponse: args.idkitResponse,
    bill: args.bill,
    wallet: args.wallet,
  };
}
