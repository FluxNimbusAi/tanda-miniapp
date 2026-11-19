// W2-F1 golden (t_92a43849): pure-lib vectors for the real seat join.
// Pins the exact signal string crossing the wire (the server recomputes
// keccak256(utf8(signal)) before any seat_grants write — drift here means
// every join silently fails binding and the route 400s).
import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import {
  SEAT_JOIN_ACTION,
  buildSeatVerifyProofBody,
  normalizeAddress,
  seatJoinSignal,
  seatJoinSignalHash,
} from '@/lib/seatJoin';

const BILL = '0xaabbccddeeff00112233445566778899aabbccd0';
const WALLET = '0x1111111111111111111111111111111111111111';

describe('seatJoin — golden signal vectors', () => {
  it('pins the canonical bill:wallet signal string exactly', () => {
    expect(seatJoinSignal(BILL, WALLET)).toBe(
      '0xaabbccddeeff00112233445566778899aabbccd0:0x1111111111111111111111111111111111111111',
    );
  });

  it('lowercases mixed case and 0X prefixes (server ADDR_RE parity)', () => {
    const mixed = '0xAaBbCcDDEEFF00112233445566778899AABBCCD0';
    expect(normalizeAddress(mixed)).toBe(BILL);
    expect(normalizeAddress('0X' + mixed.slice(2))).toBe(BILL);
    expect(seatJoinSignal(mixed, '0X1111111111111111111111111111111111111111')).toBe(
      `${BILL}:${WALLET}`,
    );
  });

  it('rejects malformed inputs with null (never burn a proof nonce)', () => {
    expect(seatJoinSignal('', WALLET)).toBeNull();
    expect(seatJoinSignal(BILL, '0x123')).toBeNull();
    expect(seatJoinSignal(BILL, undefined)).toBeNull();
    expect(seatJoinSignal(null, WALLET)).toBeNull();
    expect(seatJoinSignal(BILL + 'f', WALLET)).toBeNull(); // 41 hex
    expect(seatJoinSignal('0xgabbccddeeff00112233445566778899aabbccd', WALLET)).toBeNull();
  });

  it('keccak binding matches the EXACT computation verify-proof performs', () => {
    const sig = seatJoinSignal(BILL, WALLET) as string;
    // Same primitives as the route: viem keccak256(toBytes(`${billL}:${walletL}`)).
    expect(seatJoinSignalHash(sig)).toBe(keccak256(toBytes(`${BILL}:${WALLET}`)));
  });

  it('golden /api/verify-proof body: rp_id + idkitResponse + bill + wallet, nothing else', () => {
    const proof = { protocol_version: '4', nonce: 'n1', responses: [] };
    const body = buildSeatVerifyProofBody({
      rp_id: 'rp_test',
      idkitResponse: proof,
      bill: BILL,
      wallet: WALLET,
    });
    expect(body).toEqual({
      rp_id: 'rp_test',
      idkitResponse: proof,
      bill: '0xaabbccddeeff00112233445566778899aabbccd0',
      wallet: '0x1111111111111111111111111111111111111111',
    });
    // Exact key set — the Harley P0 was a MISSING leg; guards against future
    // silent additions too.
    expect(Object.keys(body).sort()).toEqual([
      'bill',
      'idkitResponse',
      'rp_id',
      'wallet',
    ]);
  });

  it('one registered RP action for all bills (indexer PK is bill:nullifier)', () => {
    expect(SEAT_JOIN_ACTION).toBe('seat-join');
  });
});
