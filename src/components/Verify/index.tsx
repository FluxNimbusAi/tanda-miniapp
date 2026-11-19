'use client';
import { IDKit, orbLegacy, proofOfHuman, type RpContext } from '@worldcoin/idkit';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { useState } from 'react';
import {
  buildSeatVerifyProofBody,
  normalizeAddress,
  seatJoinSignal,
} from '@/lib/seatJoin';

/** Seat context for the W2-F1 real join: the bill whose roster the wallet sits
 *  on. When present the proof is cryptographically bound to it via
 *  signal = `${bill}:${wallet}` and verify-proof can fire seat_grants. */
export type SeatContext = { bill: string; wallet: string };

/** RP action for the seat-join leg. Pinned to 'bill:confirm': a member of the
 *  frozen allowlist in src/lib/rpSignatureGuard.ts (PR #14) — the signing
 *  oracle refuses anything else. With a seat set the caller-supplied action
 *  never reaches the wire; the demo path keeps it untouched. */
const SEAT_JOIN_ACTION = 'bill:confirm';

/**
 * World ID verification via IDKit (native World App and web). Server-side
 * verification is mandatory in IDKit 4.x: /api/rp-signature produces the RP
 * signature (nonce = single-use replay key) and /api/verify-proof forwards to
 * the Developer Portal v4 endpoint.
 *
 * W2-F1 (t_92a43849): with `seat` set this is the REAL JOIN leg —
 *   rp-signature -> proofOfHuman({ signal: bill:wallet }) ->
 *   verify-proof { rp_id, idkitResponse, bill, wallet } -> seat_grants.
 * Success requires granted === true: a portal-verified proof that never
 * landed a seat_grants row is NOT a join (Harley P0: the old demo POSTed
 * { rp_id, idkitResponse } with an empty signal, so no grant could ever fire).
 * Without `seat` the component keeps the template demo behavior unchanged.
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
      // bill:wallet pair can never be granted, so never start the proof.
      const billL = seat ? normalizeAddress(seat.bill) : null;
      const walletL = seat ? normalizeAddress(seat.wallet) : null;
      const signal = seat ? seatJoinSignal(seat.bill, seat.wallet) : '';
      if (seat && (signal === null || billL === null || walletL === null)) {
        setButtonState('failed');
        setTimeout(() => setButtonState(undefined), 2000);
        onVerified?.(false);
        return;
      }

      // Server-side RP signature (IDKit 4.x mandatory backend duty).
      const rpRes = await fetch('/api/rp-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: seat ? SEAT_JOIN_ACTION : action }),
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

      // Use IDKit request API. Seat join requests the World ID 4.0
      // proof-of-human credential (legacy Orb fallback built into the preset)
      // with the bill:wallet binding as signal; the demo keeps orbLegacy.
      const request = await IDKit.request({
        app_id: process.env.NEXT_PUBLIC_APP_ID as `app_${string}`,
        action,
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

      // Verify the proof on the server — seat join carries the bill+wallet
      // legs so verify-proof can enforce keccak256(bill:wallet) == signal_hash
      // and write the seat_grants row through the indexer.
      const response = await fetch('/api/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          seat
            ? buildSeatVerifyProofBody({
                rp_id: rpSig.rp_id,
                idkitResponse: completion.result,
                bill: billL as string,
                wallet: walletL as string,
              })
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
