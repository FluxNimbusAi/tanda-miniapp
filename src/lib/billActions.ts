// W10 bill-action plumbing: EVERY bill write is factory.callBill wrapping clone calldata.
// Clones are never transaction targets (MiniKit invalid_contract entrypoint gate,
// audit correction #1). The two client write targets in the whole app are exactly
// the two portal entrypoints: prod factory + USDC (approve).
import { encodeFunctionData, type Abi, type Address } from 'viem';
import BillABI from '@/abi/TandaBillV2.json';
import FactoryABI from '@/abi/TandaBillFactory.json';

export type ActionSpec = { label: string; to: Address; data: `0x${string}` };

/** Encode a clone call and wrap it in the frozen factory's callBill pass-through. */
export function billAction(
  bill: Address,
  factory: Address,
  fn: string,
  args: readonly unknown[],
): ActionSpec {
  // Loose Abi cast: artifact JSON is not const-inferred; name-keyed lookup
  // keeps runtime behavior identical to the e2e C-matrix encodings.
  const inner = encodeFunctionData({
    abi: BillABI as unknown as Abi,
    functionName: fn,
    args: [...args],
  });
  const data = encodeFunctionData({
    abi: FactoryABI as unknown as Abi,
    functionName: 'callBill',
    args: [bill, inner],
  });
  return { label: fn, to: factory, data };
}

/** Direct USDC approve (second entrypoint; spender is the clone itself). */
export function usdcApprove(
  usdc: Address,
  bill: Address,
  amount: bigint,
): ActionSpec {
  return {
    label: 'approve',
    to: usdc,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function', name: 'approve', stateMutability: 'nonpayable',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'approve',
      args: [bill, amount],
    }),
  };
}

export type SeatRow = {
  seatId: number;
  wallet: Address;
  active: boolean;
  confirmed: boolean;
  verified: boolean | null; // null = not in seat_grants index yet
  // C2 ruling addendum (t_96389deb): SeatWalletRotated observed after
  // fullyConfirmedAt while the seat is in confirmedMask. Event-derived
  // visibility flag; absent/false = no anomaly (neutral chip).
  postConfirmRotation?: boolean;
};

/** confirmedMask bit for a seat index — BigInt() form (template target < ES2020). */
export function maskBit(confirmedMask: bigint, seatId: number): boolean {
  return ((confirmedMask >> BigInt(seatId)) & BigInt(1)) === BigInt(1);
}


