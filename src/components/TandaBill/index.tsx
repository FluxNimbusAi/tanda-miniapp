'use client';

// Tanda W8 shell — STAGED CONTRACT LANE (rehearsal, zero real money).
// Provenance: tanda-sync @6c48e48; binding rules from
// HARLEY_W8_FRONTEND_DELTA_20261116 (courier lane):
//  - settlements() is a 7-POSITIONAL-OUTPUT tuple (V1 3-output arity = stale-binding trap)
//  - per-seat payouts MUST come from settlementPayouts(settlementId) (struct getter
//    omits the dynamic array member)
//  - factory surface: createBill / implementation / isBill
//  - refundSettlement(id) is the bounded escape hatch
//  - two eras: factory clones (isBill true) vs legacy direct (e.g. W5 0x8644…b12)
import FactoryABI from '@/abi/TandaBillFactory.json';
import BillABI from '@/abi/TandaBillV2.json';
import { TANDA } from '@/config/tanda';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { useWaitForUserOperationReceipt } from '@worldcoin/minikit-react';
import { useEffect, useState } from 'react';
import { worldchainSepolia } from 'viem/chains';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
} from 'viem';

type Era = 'factory' | 'legacy' | 'unknown';

const ZERO: Address = '0x0000000000000000000000000000000000000000';

const publicClient = createPublicClient({
  chain: worldchainSepolia,
  transport: http(TANDA.rpcUrl),
});

/**
 * Bill status probe with era detection:
 * factory clone => factory.isBill(bill) true; legacy direct => code exists but
 * isBill false. Binds V2 ABI either way; the era flag drives arity notes below.
 */
async function probeBill(bill: Address): Promise<{
  era: Era;
  token: Address;
  window: bigint;
  maxHold: bigint;
  escrow: bigint;
  seatCount: bigint;
  lastSettlement: string;
}> {
  const code = await publicClient.getCode({ address: bill });
  if (!code || code === '0x')
    return { era: 'unknown', token: ZERO, window: 0n, maxHold: 0n, escrow: 0n, seatCount: 0n, lastSettlement: 'no code at address' };
  const isFactoryBill = await publicClient.readContract({
    address: TANDA.factory, abi: FactoryABI, functionName: 'isBill', args: [bill],
  }).catch(() => false);
  const read = <T,>(fn: string, args: any[] = []): Promise<T> =>
    publicClient.readContract({ address: bill, abi: BillABI, functionName: fn, args } as any) as Promise<T>;
  const token = await read<Address>('token');
  const window = await read<bigint>('SETTLEMENT_WINDOW');
  const maxHold = await read<bigint>('MAX_HOLD');
  const escrow = await read<bigint>('escrowBalance');
  const seatCount = await read<bigint>('activeSeatCount');
  // settlements(id) 7-tuple: (id?..., per canonical ABI: [uint256,uint64,uint64,uint256,uint256,uint64,bool])
  // + dynamic payouts array EXPOSED ONLY via settlementPayouts — struct-getter trap.
  const total = await read<bigint>('totalExpenses');
  let lastSettlement = `expenses=${total} (none initiated)`;
  try {
    const settling = await read<bigint[]>('settlements', [0]);
    const payouts = await read<bigint[]>('settlementPayouts', [0]);
    lastSettlement = `set#0 tuple=${settling.length}/7 payouts=${payouts.length} seats`;
  } catch { /* no settlements yet */ }
  return { era: isFactoryBill ? 'factory' : 'legacy', token, window, maxHold, escrow, seatCount, lastSettlement };
}

const zero: Address = '0x0000000000000000000000000000000000000000';

export const TandaBill = () => {
  const [seatInput, setSeatInput] = useState('');
  const [billInput, setBillInput] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [userOpHash, setUserOpHash] = useState('');
  const [status, setStatus] = useState<string>('');

  const { isLoading, isSuccess, isError } = useWaitForUserOperationReceipt({
    client: publicClient, userOpHash,
  });

  useEffect(() => {
    if (isSuccess && userOpHash) {
      // NOTE (arch leg): userOpHash != eth tx hash; BillCreated decode belongs in
      // a backend/indexer or via MiniKit wallet-auth receipt lookup — staged lane
      // reports confirmation only.
      setState('success');
      setStatus('createBill confirmed — bill address pending indexer decode');
      setUserOpHash('');
    } else if (isError && userOpHash) {
      setState('failed');
      setUserOpHash('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, isSuccess]);

  const parseSeats = (): Address[] => {
    const seats = seatInput.split(/[\s,]+/).filter(Boolean) as Address[];
    if (!seats.length || !seats.every((s) => isAddress(s))) throw new Error('seats: comma-separated valid addresses required');
    return seats;
  };

  const onClickCreateBill = async () => {
    setState('pending');
    try {
      const result = await MiniKit.sendTransaction({
        chainId: TANDA.chainId,
        transactions: [{
          to: TANDA.factory,
          data: encodeFunctionData({
            abi: FactoryABI, functionName: 'createBill',
            // W6-V2 canonical token = USDC on this chain; seats = initial roster
            // (factory passes it into initialize atomically — child onlyOwner trap).
            args: [TANDA.usdcSepolia as Address, parseSeats()],
          }),
        }],
      });
      if (!result.data?.userOpHash) throw new Error('No userOpHash returned');
      setUserOpHash(result.data.userOpHash);
    } catch (err) {
      console.error(err);
      setState('failed');
    }
  };

  const onClickProbeBill = async () => {
    if (!isAddress(billInput)) { setStatus('invalid bill address'); return; }
    setStatus('probing…');
    try {
      const p = await probeBill(billInput as Address);
      setStatus(
        `era=${p.era} token=${p.token} window=${p.window}s maxHold=${p.maxHold}s ` +
        `escrow=${p.escrow} seats=${p.seatCount} | ${p.lastSettlement}`,
      );
    } catch (e) {
      setStatus(`probe failed: ${(e as Error).message.slice(0, 120)}`);
    }
  };

  return (
    <div className="grid w-full gap-4 rounded-xl border p-4">
      <p className="text-lg font-semibold">Tanda Bill (W8 shell — chain {TANDA.chainId})</p>
      <LiveFeedback
        label={{ failed: 'Transaction failed', pending: 'Transaction pending', success: 'Transaction confirmed' }}
        state={state === 'idle' ? undefined : state}
      />
      <input
        className="rounded border p-2 text-sm"
        placeholder="seat addresses, comma-separated (0x…,0x…)"
        value={seatInput}
        onChange={(e) => setSeatInput(e.target.value)}
      />
      <Button onClick={onClickCreateBill} disabled={state === 'pending'}>
        Create Bill (factory.createBill)
      </Button>
      <input
        className="rounded border p-2 text-sm"
        placeholder="bill address to probe (factory clone or legacy direct)"
        value={billInput}
        onChange={(e) => setBillInput(e.target.value)}
      />
      <Button onClick={onClickProbeBill} variant="secondary">Probe Bill (era + arity)</Button>
      {status && <p className="break-all text-xs opacity-70">{status}</p>}
      {isLoading && <p className="text-xs opacity-60">waiting for userOp receipt…</p>}
    </div>
  );
};
