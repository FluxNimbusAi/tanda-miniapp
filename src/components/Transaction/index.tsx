'use client';

import TestContractABI from '@/abi/TestContract.json';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { stageCaption, stuckMessage } from '@/lib/userOpStatus';
import { useUserOpStatus } from '@/lib/useUserOpStatus';
import { useEffect, useRef, useState } from 'react';
import { encodeFunctionData } from 'viem';

/**
 * This component is used to get a token from a contract
 * For this to work you need to add the contract address to contract entrypoints
 * inside of  Dev Portal > Configuration > Advanced
 * The general design pattern here is
 * 1. Trigger the transaction
 * 2. Track the userOp through the golden path (W2.5-5): pending -> mined.
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
  const [whichButton, setWhichButton] = useState<'getToken' | 'transferToken'>(
    'getToken',
  );
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
    setWhichButton('getToken');
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

  // This is a basic ERC20 transfer using the token you minted
  // Make sure to call Mint Token first
  const onClickTransferToken = async () => {
    setWhichButton('transferToken');
    setButtonState('pending');
    const recipient = (await MiniKit.getUserByUsername('alex')).walletAddress;
    const transferAmount = '500000000000000000';

    try {
      const result = await MiniKit.sendTransaction({
        chainId: 480,
        transactions: [
          {
            to: myContractToken,
            data: encodeFunctionData({
              abi: TestContractABI,
              functionName: 'transfer',
              args: [recipient, transferAmount],
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
        state={whichButton === 'getToken' ? buttonState : undefined}
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
      <LiveFeedback
        label={{
          failed: 'Transaction failed',
          pending: 'Transaction pending',
          success: 'Transaction successful',
        }}
        state={whichButton === 'transferToken' ? buttonState : undefined}
        className="w-full"
      >
        <Button
          onClick={onClickTransferToken}
          disabled={lifecycle.isTracking}
          size="lg"
          variant="tertiary"
          className="w-full"
        >
          Transfer Token
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
