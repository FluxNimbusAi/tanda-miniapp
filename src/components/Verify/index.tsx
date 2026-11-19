'use client';
import { IDKit, orbLegacy, proofOfHuman, type RpContext } from '@worldcoin/idkit';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { useState } from 'react';

/** Seat context for the W2-F1 real join: the bill whose roster the wallet sits
 *  on. When present the proof is cryptographically bound to it via
 *  signal = `${billL}:${walletL}` so /api/verify-proof can fire seat_grants. */
export type SeatContext = { bill: string; wallet: string };

/** RP action used for the seat-join leg. Pinned to `bill:confirm`: a member of
 *  the frozen server-side enum in src/lib/rpSignatureGuard.ts (PR #14 — the
 *  signing oracle signs ONLY bill:confirm|bill:execute|bill:rotate), and the
 *  nullifier is deterministic per (rp_id, action) while the indexer's
 *  seat_grants PK (bill_address, nullifier) lets one human join many bills.
 *  Contract shared with F1b (t_74f05aa6) — do not change unilaterally. */
const SEAT_JOIN_ACTION = 'bill:confirm';

/** Same acceptance rule as verify-proof's ADDR_RE (client is stricter: we
 *  normalize first, so what we accept equals what the server will ledger). */
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Trim + full lowercase (normalizes a 0X prefix too), or null when the value
 *  is not a 0x + 40-hex address. Mirrors the server's ADDR_RE. */
function normalizeAddress(a: string | null | undefined): string | null {
  if (typeof a !== 'string') return null;
  const s = a.trim().toLowerCase();
  return ADDRESS_RE.test(s) ? s : null;
}

/** The frozen signal contract: `${billL}:${walletL}` (verify-proof recomputes
 *  keccak256 over exactly this string), or null when either side is invalid. */
function seatJoinSignal(
  bill: string | null | undefined,
  wallet: string | null | undefined,
): string | null {
  const b = normalizeAddress(bill);
  const w = normalizeAddress(wallet);
  if (b === null || w === null) return null;
  return `${b}:${w}`;
}

/**
 * World ID verification via IDKit (native World App and web). Server-side
 * verification is mandatory in IDKit 4.x: /api/rp-signature produces the RP
 * signature (nonce = single-use replay key) and /api/verify-proof forwards to
 * the Developer Portal v4 endpoint.
 *
 * W2-F1a (issue #15, t_5824a67a): with `seat` set this is the REAL JOIN leg —
 *   rp-signature(bill:confirm) ->
 *   proofOfHuman({ signal: `${billL}:${walletL}` }) ->
 *   verify-proof { rp_id, idkitResponse, bill, wallet } -> seat_grants.
 * Success requires granted === true: a portal-verified proof that never
 * landed a seat_grants row is NOT a join (Harley P0: the old demo POSTed
 * { rp_id, idkitResponse } with an empty orbLegacy signal under
 * action=test-action, so no grant could ever fire). Without `seat` the
 * component keeps the template demo behavior unchanged.
 * @see https://docs.world.org/mini-apps/commands/verify#verifying-the-proof
 */
export const Verify = ({
  action,
  seat,
  onVerified,
}: {
  action: string;
  seat?: SeatContext;
  /** Fired after any seat-join attempt settles (granted true OR false) so the
   *  host panel can refresh badges — a 409 duplicate means the grant already
   *  exists and the badge, not the button, is the source of truth. */
  onVerified?: (granted: boolean) => void;
}) => {
  const [buttonState, setButtonState] = useState<
    'pending' | 'success' | 'failed' | undefined
  >(undefined);

  const onClickVerify = async () => {
    setButtonState('pending');
    try {
      // Resolve the seat binding BEFORE touching IDKit: an invalid
      // bill:wallet pair can never be granted, and starting the proof would
      // burn the single-use RP nonce for nothing.
      const billL = seat ? normalizeAddress(seat.bill) : null;
      const walletL = seat ? normalizeAddress(seat.wallet) : null;
      const signal = seat ? seatJoinSignal(seat.bill, seat.wallet) : null;
      if (seat && (billL === null || walletL === null || signal === null)) {
        setButtonState('failed');
        setTimeout(() => setButtonState(undefined), 2000);
        onVerified?.(false);
        return;
      }

      // Seat join pins the allowlisted RP action; demo path keeps the
      // caller-supplied action untouched.
      const rpAction = seat ? SEAT_JOIN_ACTION : action;

      // Fetch RP signature from the backend (server-side duty, PR #14 gate).
      const rpRes = await fetch('/api/rp-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: rpAction }),
      });

      if (!rpRes.ok) {
        throw new Error('Failed to get RP signature');
      }

      const rpSig = await rpRes.json();
      const rpContext: RpContext = {
        rp_id: rpSig.rp_id,
        nonce: rpSig.nonce,
        created_at: rpSig.created_at,
        expires_at: rpSig.expires_at,
        signature: rpSig.sig,
      };

      // Use IDKit request API. The seat join requests the World ID 4.0
      // proof-of-human credential (legacy Orb fallback built into the
      // preset) cryptographically bound to bill:wallet via the signal; the
      // demo keeps orbLegacy with an empty signal exactly as before.
      const request = await IDKit.request({
        app_id: process.env.NEXT_PUBLIC_APP_ID as `app_${string}`,
        action: rpAction,
        rp_context: rpContext,
        allow_legacy_proofs: true,
      }).preset(
        seat
          ? proofOfHuman({ signal: signal as string })
          : orbLegacy({ signal: '' }),
      );

      const completion = await request.pollUntilCompletion();

      if (!completion.success) {
        setButtonState('failed');
        setTimeout(() => setButtonState(undefined), 2000);
        onVerified?.(false);
        return;
      }

      // Verify the proof on the server — the seat join carries the bill +
      // wallet legs so verify-proof can enforce
      // keccak256(`${billL}:${walletL}`) === signal_hash and write the
      // seat_grants row through the indexer.
      const response = await fetch('/api/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          seat
            ? {
                rp_id: rpSig.rp_id,
                idkitResponse: completion.result,
                bill: billL as string,
                wallet: walletL as string,
              }
            : { rp_id: rpSig.rp_id, idkitResponse: completion.result },
        ),
      });

      const data = await response.json();
      // Seat join: verified AND granted. Demo: verified is enough.
      const granted = seat
        ? data.success === true && data.granted === true
        : data.success === true;
      if (granted) {
        setButtonState('success');
      } else {
        setButtonState('failed');
        setTimeout(() => setButtonState(undefined), 2000);
      }
      onVerified?.(granted);
    } catch {
      setButtonState('failed');
      setTimeout(() => setButtonState(undefined), 2000);
      onVerified?.(false);
    }
  };

  return (
    <div className="grid w-full gap-4">
      <p className="text-lg font-semibold">Verify</p>
      <LiveFeedback
        label={{
          failed: 'Failed to verify',
          pending: 'Verifying',
          success: 'Verified',
        }}
        state={buttonState}
        className="w-full"
      >
        <Button
          onClick={onClickVerify}
          disabled={buttonState === 'pending'}
          size="lg"
          variant="primary"
          className="w-full"
        >
          Verify with World ID
        </Button>
      </LiveFeedback>
    </div>
  );
};
