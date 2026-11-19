'use client';

import TestContractABI from '@/abi/TestContract.json';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { stageCaption, stuckMessage } from '@/lib/userOpStatus';
import { useUserOpStatus } from '@/lib/useUserOpStatus';
import { useEffect, useRef, useState } from 'react';
import { encodeFunctionData } from 'viem';

/**
 * W26-FIX (CoS dual-preservation ruling, PR #26): this file SURVIVES the
 * OPP-001 purge. Deleting it wholesale (fold head 01062e2) would revert the
 * landed #28 useUserOpStatus wiring — re-introducing the eternal-pending
 * defect (OPP-003 dead-end #1) — so the lifecycle import + hook state below
 * are byte-pinned against main and the templateResidue golden now PINS that
 * fact instead of asserting deletion. The demo USDC transfer lane to the
 * template's demo recipient IS purged (store-review residue). The component
 * is not
 * rendered by any shipped page: home is the product lane only (TandaBill),
 * landing is the dual-mode ModeGate -> LiveExplorer gate.
 *
 * Design pattern (unchanged, W2.5-5):
 * 1. Trigger the transaction
 * 2. Track the userOp through the golden path: pending -> mined.
 *    This demo has no :8096 indexer lane, so `mined` IS the honest terminal
 *    (indexedNa) — never a faked "indexed" tick.
 * 3. Handle success/failure — failures NAME the stuck stage + retry control
 */
export const Transaction = () => {
  // See the code for this contract here: https://worldscan.org/address/0xF0882554ee924278806d708396F1a7975b732522#code
  const myContractToken = '0xF0882554ee924278806d708396F1a7975b732522';
  const [buttonState, setButtonState] = useState<
    'pending' | 'success' | 'failed' | undefined
  >(undefined);
  // W2.5-5 — same class as TandaBill: ONE lifecycle machine (the pure
  // golden path in @/lib/userOpStatus), indexStatusPath null opts the
  // indexed stage out because demo-contract txs have nothing to index.
  const lifecycle = useUserOpStatus({ indexStatusPath: null });
  const handledSeqRef = useRef(0);

  useEffect(() => {
    const s = lifecycle.snapshot;
    if (!s.terminal || s.seq <= handledSeqRef.current) return;
    handledSeqRef.current = s.seq;
    setButtonState(s.stage === 'failed' ? 'failed' : 'success');
    setTimeout(() => setButtonState(undefined), 3000);
  }, [lifecycle.snapshot]);

  // This is a basic transaction call to mint a token
  const onClickGetToken = async () => {
    setButtonState('pending');

    try {
      const result = await MiniKit.sendTransaction({
        chainId: 480,
        transactions: [
          {
            to: myContractToken,
            data: encodeFunctionData({
              abi: TestContractABI,
              functionName: 'mintToken',
              args: [],
            }),
          },
        ],
      });

      console.log(
        'Transaction submitted, waiting for confirmation:',
        result.data.userOpHash,
      );

      if (!result.data.userOpHash) {
        throw new Error('No userOpHash returned');
      }

      lifecycle.track(result.data.userOpHash);
    } catch (err) {
      console.error('Error:', err);
      setButtonState('failed');
      setTimeout(() => setButtonState(undefined), 3000);
    }
  };


  return (
    <div className="grid w-full gap-4">
      <p className="text-lg font-semibold">Transaction</p>
      <LiveFeedback
        label={{
          failed: 'Transaction failed',
          pending: 'Transaction pending',
          success: 'Transaction successful',
        }}
        state={buttonState}
        className="w-full"
      >
        <Button
          onClick={onClickGetToken}
          disabled={lifecycle.isTracking}
          size="lg"
          variant="primary"
          className="w-full"
        >
          Get Token
        </Button>
      </LiveFeedback>
      {/* W2.5-5 — stage visibility + named-stage retry, same class as
          TandaBill: eternal pending is shown AS a defect with a name. */}
      {lifecycle.isTracking && (
        <p className="text-xs opacity-60" data-testid="demo-lifecycle-stage">
          {stageCaption(lifecycle.snapshot)}
        </p>
      )}
      {lifecycle.stage === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 rounded border p-2 border-red-500/40">
          <p className="break-all text-xs text-red-500" data-testid="demo-lifecycle-stuck">
            {stuckMessage(lifecycle.snapshot)}
          </p>
          <Button onClick={lifecycle.retry} variant="secondary" size="sm">
            Retry tracking
          </Button>
        </div>
      )}
    </div>
  );
};
