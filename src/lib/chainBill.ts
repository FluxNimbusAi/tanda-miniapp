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

/**
 * Cheap chain probe for the §7.4 disagreement guard (OVERLAY-1 t_cead034d):
 * reads the 8-field settlements(i) getter for i in 0..expectedCount inclusive
 * (one past the indexer's count catches "chain has MORE"), returning only the
 * fields the indexer's settlements rows also carry.
 */
// Fast-twin variant (pre-P0.1a): same selector settlements(uint256), struct
// WITHOUT claimedMask -> 7 outputs. Must keep the real name or viem derives
// the wrong selector. Verified live vs FastTandaBillV2.sol L70-79.
const settlements7Abi = [
  {
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
      { name: "fullyConfirmedAt", type: "uint64" },
      { name: "refunded", type: "bool" },
    ],
  },
] as const;

export type ChainSettleProbe = {
  rows: { id: number; total_amount: string; settled_at: number; claimed_count: number; refunded: boolean }[];
  chain_more: boolean;
};
export async function probeChainSettlements(bill: Address, expectedCount: number): Promise<ChainSettleProbe> {
  const client = chainClient();
  const rows: ChainSettleProbe["rows"] = [];
  let chain_more = false;
  for (let i = 0; i <= 16; i++) {
    if (i > expectedCount) break;
    try {
      const st = (await client.readContract({ address: bill, abi: billAbi, functionName: 'settlements', args: [BigInt(i)] })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
      if (i === expectedCount + 1) chain_more = true;
      rows.push({ id: i, total_amount: st[0].toString(), settled_at: Number(st[1]), claimed_count: maskBits(st[5]).length, refunded: st[7] });
    } catch {
      break;
    }
  }
  return { rows: rows.slice(0, expectedCount), chain_more: chain_more || rows.length > expectedCount };
}

/** Pure diff of indexer rows vs chain probe; returns human-readable mismatches (empty = agree). */
export function compareIndexChain(
  idx: { settlement_id: number | string; total_amount?: string | number; settled_at?: number; claimed_count?: number; refunded?: boolean }[],
  probe: ChainSettleProbe,
): string[] {
  const diffs: string[] = [];
  if (probe.chain_more) diffs.push(`chain has settlements beyond indexer count (${idx.length})`);
  for (const c of probe.rows) {
    const i = idx.find((r) => Number(r.settlement_id) === c.id);
    if (!i) {
      diffs.push(`settlement ${c.id} on chain missing from index`);
      continue;
    }
    if (i.total_amount != null && String(i.total_amount) !== c.total_amount)
      diffs.push(`settlement ${c.id} total_amount index=${i.total_amount} chain=${c.total_amount}`);
    if (i.settled_at != null && (i.settled_at > 0) !== (c.settled_at > 0))
      diffs.push(`settlement ${c.id} settled flag index=${i.settled_at > 0} chain=${c.settled_at > 0}`);
    if (i.claimed_count != null && i.claimed_count !== c.claimed_count)
      diffs.push(`settlement ${c.id} claimed_count index=${i.claimed_count} chain=${c.claimed_count}`);
    if (i.refunded != null && i.refunded !== c.refunded)
      diffs.push(`settlement ${c.id} refunded index=${i.refunded} chain=${c.refunded}`);
  }
  return diffs;
}

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
    // null = variant without on-chain claim tracking (fast-twin): UNKNOWABLE,
    // never faked. V2 bills carry the mask.
    claimed_mask: string | null;
    refunded: boolean;
  }[];
  events: ChainFeedEvent[];
  source: "chain";
  as_of_block: number;
};

/**
 * Pure state->feed synthesis (extracted for goldens; Xixi §7.4 + Flux audit
 * item 1). IMPLIED-COMPLETION RULE: settlements existing proves funding
 * happened even when escrow has since drained to 0 - the CTA defect on
 * fully-settled bills ("Fund escrow" fallback) came from deriving funded
 * from balance instead of from consequence. Amount for a drained-escrow
 * funded row cites the first settlement total (a bound, not a lie).
 */
export function synthesizeFeed(
  escrowBalance: bigint,
  settlements: ChainBill["settlements"],
  blk: number,
): ChainFeedEvent[] {
  if (escrowBalance <= BigInt(0) && settlements.length === 0) return [];
  const out: ChainFeedEvent[] = [];
  out.push({
    event: "EscrowFunded",
    block: blk,
    amount:
      escrowBalance > BigInt(0)
        ? escrowBalance.toString()
        : (settlements[0]?.total_amount ?? null),
  });
  for (const st of settlements) {
    out.push({ event: "SettlementInitiated", block: blk, amount: st.total_amount });
    for (const seat of maskBits(BigInt(st.confirmed_mask)))
      out.push({ event: "SeatConfirmed", block: blk, seat_id: seat });
    if (st.settled_at > 0)
      out.push({ event: "SettlementExecuted", block: blk, amount: st.total_amount });
    if (st.claimed_mask != null)
      for (const seat of maskBits(BigInt(st.claimed_mask)))
        out.push({ event: "SeatPayoutClaimed", block: blk, seat_id: seat });
    if (st.refunded)
      out.push({ event: "SettlementRefunded", block: blk, amount: st.total_amount });
  }
  return out;
}

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
  type St8 = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
  type St7 = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean];
  for (let i = 0; i < 16; i++) {
    // V2 layout first; on decode failure try the fast-twin 7-field layout;
    // only a revert in BOTH means the index is out of range.
    let st8: St8 | null = null;
    let st7: St7 | null = null;
    try {
      st8 = (await client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "settlements",
        args: [BigInt(i)],
      })) as unknown as St8;
    } catch {
      try {
        st7 = (await client.readContract({
          address: addr,
          abi: settlements7Abi,
          functionName: "settlements",
          args: [BigInt(i)],
        })) as unknown as St7;
      } catch {
        break; // neither variant answers: end of array
      }
    }
    // payouts accessor is OPTIONAL per variant: a failed read keeps the row.
    let payouts: readonly bigint[] = [];
    try {
      payouts = (await client.readContract({
        address: addr,
        abi: billAbi,
        functionName: "settlementPayouts",
        args: [BigInt(i)],
      })) as readonly bigint[];
    } catch {
      /* variant without the accessor - state row stays honest */
    }
    if (st7) {
      settlements.push({
        id: i,
        total_amount: st7[0].toString(),
        payouts: payouts.map((p) => p.toString()),
        settled_at: Number(st7[1]),
        initiated_at: Number(st7[2]),
        expected_mask: st7[3].toString(),
        confirmed_mask: st7[4].toString(),
        claimed_mask: null, // no on-chain claim proof in this variant
        refunded: st7[6],
      });
    } else if (st8) {
      settlements.push({
        id: i,
        total_amount: st8[0].toString(),
        payouts: payouts.map((p) => p.toString()),
        settled_at: Number(st8[1]),
        initiated_at: Number(st8[2]),
        expected_mask: st8[3].toString(),
        confirmed_mask: st8[4].toString(),
        claimed_mask: st8[5].toString(),
        refunded: st8[7],
      });
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
  // FIX (Flux audit item 1, CTA defect): a fully-settled bill has drained
  // escrow to 0, but settlements existing PROVES funding necessarily
  // happened - synthesize EscrowFunded from existence, not from balance.
  if (events.length === 0) {
    events = synthesizeFeed(escrowBalance, settlements, Number(asOf));
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
