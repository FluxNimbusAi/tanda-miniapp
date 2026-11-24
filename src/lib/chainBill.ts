// UGLY-1 (t_b7c72897) "Direct Truth" read path: bill state decoded straight
// from chain via public RPC eth_call/eth_getLogs — no DB, no tunnel, nothing
// to replicate. The contract IS the database; the UI shows what it says.
// Indexer stays preferred on the dev lane; this module answers wherever the
// :8096 box can't be reached (production) or when source=chain forces it.
import {
  createPublicClient,
  http,
  decodeEventLog,
  type Address,
  type Abi,
} from "viem";

export const CHAIN_RPC_URL =
  process.env.CHAIN_READ_RPC_URL ??
  "https://worldchain-sepolia.g.alchemy.com/public"; // 4801
const LOG_WINDOW = BigInt(process.env.CHAIN_READ_LOG_WINDOW ?? "40000");
const CALL_TIMEOUT_MS = 6000;

export function chainClient(): ReturnType<typeof createPublicClient> {
  return createPublicClient({
    transport: http(CHAIN_RPC_URL, { timeout: CALL_TIMEOUT_MS, retryCount: 0 }),
  });
}

export const billAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "escrowBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeSeatCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "seats",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [
      { name: "wallet", type: "address" },
      { name: "joinedAt", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  {
    // NOTE (live-verified 2026-11-24): the deployed auto-getter OMITS the
    // dynamic payouts member (contract comment L476) -> 8 outputs. Payouts
    // come from the explicit settlementPayouts(uint256) accessor.
    type: "function",
    name: "settlements",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [
      { name: "totalAmount", type: "uint256" },
      { name: "settledAt", type: "uint64" },
      { name: "initiatedAt", type: "uint64" },
      { name: "expectedMask", type: "uint256" },
      { name: "confirmedMask", type: "uint256" },
      { name: "claimedMask", type: "uint256" },
      { name: "fullyConfirmedAt", type: "uint64" },
      { name: "refunded", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "settlementPayouts",
    stateMutability: "view",
    inputs: [{ name: "settlementId", type: "uint256" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "settlementInitiated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "totalExpenses",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // Feed-parity events (subset of V2's emitted set; unknown logs are skipped).
  {
    type: "event",
    name: "EscrowFunded",
    inputs: [
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementInitiated",
    inputs: [
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "expectedSeats", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SeatConfirmed",
    inputs: [
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "seatId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SettlementExecuted",
    inputs: [
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "settledAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SeatPayoutClaimed",
    inputs: [
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "seatId", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementRefunded",
    inputs: [
      { name: "settlementId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

/** bit i set -> seat i present in mask. Canonical decode for masks on-chain. */
export function maskBits(mask: bigint): number[] {
  const out: number[] = [];
  const Z = BigInt(0);
  const ONE = BigInt(1);
  for (let i = 0; mask > Z; i++, mask >>= ONE) if (mask & ONE) out.push(i);
  return out;
}

export type ChainFeedEvent = {
  event: string;
  block: number;
  seat_id?: number | null;
  amount?: string | null;
  tx_hash?: string | null;
};

export type ChainBill = {
  core: {
    owner: Address;
    token: Address | null;
    escrow_balance: string;
    active_seats: number;
    seat_count: number;
  };
  seats: {
    seat_id: number;
    wallet: Address;
    joined_at: number;
    active: boolean;
  }[];
  settlements: {
    id: number;
    total_amount: string;
    payouts: string[];
    settled_at: number;
    initiated_at: number;
    expected_mask: string;
    confirmed_mask: string;
    claimed_mask: string;
    refunded: boolean;
  }[];
  events: ChainFeedEvent[];
  source: "chain";
  as_of_block: number;
};

/**
 * Decode one bill entirely from chain state. Throws on unreachable RPC.
 * `settlements`/`seats` arrays have no length getter, so probe-until-revert
 * with hard caps (contract MAX_SEATS=256; settlements realistically <10).
 */
export async function readChainBill(bill: Address): Promise<ChainBill> {
  const client = chainClient();
  const addr = bill;
  const [owner, token, escrowBalance, activeSeatCount, asOf] =
    await Promise.all([
      client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "owner",
      }) as Promise<Address>,
      client
        .readContract({ address: addr, abi: billAbi, functionName: "token" })
        .catch(() => null) as Promise<Address | null>,
      client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "escrowBalance",
      }) as Promise<bigint>,
      client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "activeSeatCount",
      }) as Promise<bigint>,
      client.getBlockNumber(),
    ]);

  const seats: ChainBill["seats"] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const s = (await client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "seats",
        args: [BigInt(i)],
      })) as readonly [Address, bigint, boolean];
      seats.push({
        seat_id: i,
        wallet: s[0],
        joined_at: Number(s[1]),
        active: s[2],
      });
    } catch {
      break;
    }
  }

  const settlements: ChainBill["settlements"] = [];
  for (let i = 0; i < 16; i++) {
    try {
      // 8 outputs: auto-getter omits dynamic payouts (see abi note above).
      const st = (await client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "settlements",
        args: [BigInt(i)],
      })) as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      const payouts = (await client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "settlementPayouts",
        args: [BigInt(i)],
      })) as readonly bigint[];
      settlements.push({
        id: i,
        total_amount: st[0].toString(),
        payouts: payouts.map((p) => p.toString()),
        settled_at: Number(st[1]),
        initiated_at: Number(st[2]),
        expected_mask: st[3].toString(),
        confirmed_mask: st[4].toString(),
        claimed_mask: st[5].toString(),
        refunded: st[7],
      });
    } catch {
      break; // out-of-range: array fully enumerated (clean revert on correct ABI)
    }
  }

  // Preferred: real event rows via eth_getLogs over a bounded window.
  let events: ChainFeedEvent[] = [];
  try {
    const from = asOf > LOG_WINDOW ? asOf - LOG_WINDOW : BigInt(0);
    const logs = await client.getLogs({
      address: addr,
      fromBlock: from,
      toBlock: asOf,
    });
    for (const log of logs) {
      try {
        const parsed = decodeEventLog({
          abi: billAbi,
          data: log.data,
          topics: log.topics,
        });
        const a = parsed.args as Record<string, unknown>;
        events.push({
          event: parsed.eventName,
          block: Number(log.blockNumber),
          seat_id: a.seatId != null ? Number(a.seatId) : null,
          amount: a.amount != null ? String(a.amount) : null,
          tx_hash: log.transactionHash,
        });
      } catch {
        /* foreign/non-ABI event - skip, never guess */
      }
    }
  } catch {
    /* getLogs unavailable on this provider - fall through to state synthesis */
  }

  // Synthesized-from-state rows: honest "as of" block, same names the
  // billLifecycle derivation expects. Only what the storage PROVES.
  if (
    events.length === 0 &&
    (escrowBalance > BigInt(0) || settlements.length > 0)
  ) {
    const blk = Number(asOf);
    if (escrowBalance > BigInt(0))
      events.push({
        event: "EscrowFunded",
        block: blk,
        amount: escrowBalance.toString(),
      });
    for (const st of settlements) {
      events.push({
        event: "SettlementInitiated",
        block: blk,
        amount: st.total_amount,
      });
      for (const seat of maskBits(BigInt(st.confirmed_mask)))
        events.push({ event: "SeatConfirmed", block: blk, seat_id: seat });
      if (st.settled_at > 0)
        events.push({
          event: "SettlementExecuted",
          block: blk,
          amount: st.total_amount,
        });
      for (const seat of maskBits(BigInt(st.claimed_mask)))
        events.push({ event: "SeatPayoutClaimed", block: blk, seat_id: seat });
      if (st.refunded)
        events.push({
          event: "SettlementRefunded",
          block: blk,
          amount: st.total_amount,
        });
    }
  }

  return {
    core: {
      owner,
      token,
      escrow_balance: escrowBalance.toString(),
      active_seats: Number(activeSeatCount),
      seat_count: seats.length,
    },
    seats,
    settlements,
    events,
    source: "chain",
    as_of_block: Number(asOf),
  };
}
