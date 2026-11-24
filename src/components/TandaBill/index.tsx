"use client";

// Tanda W8 shell — STAGED CONTRACT LANE (rehearsal, zero real money).
// Provenance: tanda-sync @6c48e48; binding rules from
// HARLEY_W8_FRONTEND_DELTA_20261116 (courier lane):
//  - settlements() is a 7-POSITIONAL-OUTPUT tuple (V1 3-output arity = stale-binding trap)
//  - per-seat payouts MUST come from settlementPayouts(settlementId) (struct getter
//    omits the dynamic array member)
//  - factory surface: createBill / implementation / isBill
//  - refundSettlement(id) is the bounded escape hatch
//  - two eras: factory clones (isBill true) vs legacy direct (e.g. W5 0x8644…b12)
// W10 slice: ALL bill writes route through factory.callBill (billAction helper) —
// clones are never targets (MiniKit invalid_contract gate). P0.3 badge feed reads
// /api/seat-grants (read-only indexer view; absent table = neutral chips).
// P0.3 badge UI slice (t_d1c1cf68): per-seat <SeatBadge> with three visually
// distinct states resolved purely from the exposed feed via lib/seatVerification.
import FactoryABI from "@/abi/TandaBillFactory.json";
import BillABI from "@/abi/TandaBillV2.json";
import BillV1ABI from "@/abi/TandaBillV1.json";
import { PostConfirmRotationFlag, SeatBadge } from "@/components/SeatBadge";
import { Verify } from "@/components/Verify";
import { SEAT_JOIN_ACTION } from "@/lib/seatJoin";
import { InvitePanel } from "@/components/InvitePanel";
import {
  lookupUsernamesForWallets,
  parseSeatTokens,
  resolveWalletsForHandles,
} from "@/lib/worldUsernames";
import { SettlementVectorTable } from "@/components/SettlementVector";
import { NudgeCountdown } from "@/components/NudgeCountdown";
import { nudgeStatus } from "@/lib/nudgeStatus";
import {
  buildSettlementVector,
  type SettlementVector,
} from "@/lib/settlementVector";
import { TANDA } from "@/config/tanda";
import { stageCaption, stuckMessage } from "@/lib/userOpStatus";
import { useUserOpStatus } from "@/lib/useUserOpStatus";
import {
  billAction,
  maskBit,
  usdcApprove,
  type SeatRow,
} from "@/lib/billActions";
import {
  ConfirmPreview,
  type IntentSummary,
} from "@/components/ConfirmPreview";
import {
  flagToVerification,
  resolveSeatVerification,
  verificationToFlag,
  type SeatGrantsFeed,
} from "@/lib/seatVerification";
import {
  computePostConfirmRotations,
  type RotationEventLite,
} from "@/lib/rotationAnomaly";
import { Button, LiveFeedback } from "@worldcoin/mini-apps-ui-kit-react";
import { MiniKit } from "@worldcoin/minikit-js";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { worldchainSepolia } from "viem/chains";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
  decodeFunctionData,
  type Abi,
} from "viem";

type Era = "factory-w10" | "factory-v2" | "legacy" | "unknown";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

const publicClient = createPublicClient({
  chain: worldchainSepolia,
  transport: http(TANDA.rpcUrl),
});

type BillSnapshot = {
  era: Era;
  token: Address;
  window: bigint;
  maxHold: bigint;
  escrow: bigint;
  seatCount: bigint;
  lastSettlement: string;
  initiatedAt: bigint;
  settledAt: bigint;
  confirmedMask: bigint;
  settlementTotal: bigint;
  expectedMask: bigint;
  fullyConfirmedAt: bigint;
  refunded: boolean;
  owner: Address;
};

/**
 * Bill status probe with era detection (MANDATORY branch, per Harley W8 delta
 * + Flux directive): factory clone (isBill true) binds V2 ABI — settlements()
 * 7-tuple + per-seat settlementPayouts(); legacy W5 direct (isBill false) binds
 * V1 ABI — settlements() 3-output (totalAmount, settledAt, initiatedAt), NO
 * MAX_HOLD/settlementPayouts on that lineage. WINDOW anchor is era-dependent
 * (source-verified @275f116): V2 execute gates on fullyConfirmedAt+WINDOW
 * (TandaBillV2.sol L260) with initiatedAt+MAX_HOLD as refund escape (L288);
 * V1 gates on initiatedAt+WINDOW (c2066c1 L208). The W5 stale comment "after
 * the last confirmation" (L149) is prose, not code.
 */
async function probeBill(bill: Address): Promise<BillSnapshot> {
  const blank: BillSnapshot = {
    era: "unknown",
    token: ZERO,
    window: BigInt(0),
    maxHold: BigInt(0),
    escrow: BigInt(0),
    seatCount: BigInt(0),
    lastSettlement: "no code at address",
    initiatedAt: BigInt(0),
    settledAt: BigInt(0),
    confirmedMask: BigInt(0),
    settlementTotal: BigInt(0),
    expectedMask: BigInt(0),
    fullyConfirmedAt: BigInt(0),
    refunded: false,
    owner: ZERO,
  };
  const code = await publicClient.getCode({ address: bill });
  if (!code || code === "0x") return blank;
  // W10 multi-factory era detect: whichever KNOWN_FACTORY registered the clone
  // decides lineage; a readable factory() getter on the bill marks the
  // rotate-capable forwarder era (pre-W10 clones revert it -> factory-v2).
  let mintedBy: Address | null = null;
  const isClone = code.length === 92; // EIP-1167 runtime = 45 B (0x + 90 hex)
  for (let attempt = 0; attempt < (isClone ? 4 : 1) && !mintedBy; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200)); // replica-lag guard: a bill minted seconds ago may read isBill=false on stale replicas
    for (const f of TANDA.knownFactories) {
      const isB = await publicClient
        .readContract({
          address: f,
          abi: FactoryABI,
          functionName: "isBill",
          args: [bill],
        })
        .catch(() => false);
      if (isB) {
        mintedBy = f;
        break;
      }
    }
  }
  let rotationCapable = false;
  if (mintedBy) {
    rotationCapable = await publicClient
      .readContract({ address: bill, abi: BillABI, functionName: "factory" })
      .then(() => true)
      .catch(() => false);
  }
  const isFactoryBill = mintedBy !== null;
  const era: Era = !isFactoryBill
    ? "legacy"
    : rotationCapable
      ? "factory-w10"
      : "factory-v2";
  const abi = isFactoryBill ? BillABI : BillV1ABI;
  const read = <T,>(fn: string, args: readonly unknown[] = []): Promise<T> =>
    publicClient.readContract({
      address: bill,
      abi,
      functionName: fn,
      args,
    } as unknown as Parameters<
      typeof publicClient.readContract
    >[0]) as Promise<T>;
  const snap: BillSnapshot = { ...blank, era };
  snap.token = await read<Address>("token");
  snap.window = await read<bigint>("SETTLEMENT_WINDOW");
  snap.escrow = await read<bigint>("escrowBalance");
  snap.seatCount = await read<bigint>("activeSeatCount");
  const total = await read<bigint>("totalExpenses");
  snap.lastSettlement = `expenses=${total} (none initiated)`;
  if (isFactoryBill) {
    snap.maxHold = await read<bigint>("MAX_HOLD");
    snap.owner = await read<Address>("owner");
    try {
      // tuple order (frozen ABI): totalAmount, settledAt, initiatedAt,
      // expectedMask, confirmedMask, fullyConfirmedAt, refunded
      const s = await read<
        [bigint, bigint, bigint, bigint, bigint, bigint, boolean]
      >("settlements", [0]);
      const payouts = await read<bigint[]>("settlementPayouts", [0]);
      snap.settledAt = s[1];
      snap.initiatedAt = s[2];
      snap.confirmedMask = s[4];
      snap.settlementTotal = s[0];
      snap.expectedMask = s[3];
      snap.fullyConfirmedAt = s[5];
      snap.refunded = s[6];
      snap.lastSettlement =
        `set#0 7-tuple total=${s[0]} initiatedAt=${s[2]} fullyConfirmedAt=${s[5]} ` +
        `(V2 execute gate=fullyConfirmedAt+WINDOW; refund escape=initiatedAt+MAX_HOLD; settled=${s[1]}) ` +
        `mask=${s[4]}/${s[3]} refunded=${s[6]} payouts=${payouts.length}`;
    } catch {
      /* no settlements yet */
    }
  } else {
    // W5 era: 3 outputs only — payouts never existed, MAX_HOLD absent (escape
    // hatch is V2-only). V1 execute gate = initiatedAt + WINDOW (no fullyConfirmedAt).
    try {
      const s = await read<[bigint, bigint, bigint]>("settlements", [0]);
      snap.settledAt = s[1];
      snap.initiatedAt = s[2];
      snap.lastSettlement = `set#0 LEGACY 3-tuple total=${s[0]} settledAt=${s[1]} initiatedAt=${s[2]} (V1 execute gate=initiatedAt+WINDOW)`;
    } catch {
      /* no settlements yet */
    }
  }
  return snap;
}

/** P0.3 badge layer: fold /api/seat-grants state into seat rows. Any feed
 *  failure (down route, bad JSON, missing table) leaves rows neutral —
 *  never blanks or crashes the roster (resolveSeatVerification can't throw). */
async function loadBadges(bill: Address, rows: SeatRow[]): Promise<SeatRow[]> {
  try {
    const res = await fetch(`/api/seat-grants?bill=${bill}`);
    if (!res.ok) return rows;
    const body = (await res.json().catch(() => null)) as SeatGrantsFeed;
    return rows.map((r) => ({
      ...r,
      verified: verificationToFlag(resolveSeatVerification(body, r.wallet)),
    }));
  } catch {
    /* badge feed down: neutral chips, roster stays live */
    return rows;
  }
}

/** C2 ruling addendum (t_96389deb, Option A): SeatWalletRotated logs folded
 *  through the pure resolver -> seat ids rotated AFTER full confirmation while
 *  in confirmedMask. Event-derived ONLY (ordering fact, zero state mutation).
 *  Any feed failure -> empty set: neutral chips, roster never blanks. */
async function loadAnomalyFlags(
  bill: Address,
  snap: BillSnapshot,
): Promise<Set<number>> {
  if (snap.era === "unknown" || snap.era === "legacy") return new Set();
  if (snap.fullyConfirmedAt <= BigInt(0)) return new Set();
  try {
    // Loose-typed log path mirrors the readContract discipline (artifact JSON
    // is not const-inferred); avoids any.
    const getLogsLoose = publicClient.getLogs as unknown as (q: {
      address: Address;
      abi: unknown;
      eventName: string;
      fromBlock: bigint;
    }) => Promise<{ args?: unknown; blockNumber: bigint | null }[]>;
    const logs = await getLogsLoose({
      address: bill,
      abi: BillABI,
      eventName: "SeatWalletRotated",
      fromBlock: BigInt(0),
    });
    const events: RotationEventLite[] = [];
    for (const log of logs) {
      const raw = (log.args as { seatId?: unknown } | undefined)?.seatId;
      const seatId =
        typeof raw === "bigint" || typeof raw === "number" ? Number(raw) : -1;
      if (log.blockNumber === null) continue;
      const blk = await publicClient.getBlock({ blockNumber: log.blockNumber });
      events.push({ seatId, blockTimestamp: Number(blk.timestamp) });
    }
    return computePostConfirmRotations(events, {
      confirmedMask: snap.confirmedMask,
      fullyConfirmedAt: snap.fullyConfirmedAt,
    });
  } catch {
    /* event feed down: no flags, roster stays live */
    return new Set();
  }
}

/** Active seat roster via seats(i) walk (swap-pop removal keeps indices dense;
 *  seatIdOf maps wallet -> index; confirmed bit from settlement mask). */
async function fetchSeatRows(
  bill: Address,
  snap: BillSnapshot,
): Promise<SeatRow[]> {
  if (snap.era === "unknown" || snap.era === "legacy") return [];
  const rows: SeatRow[] = [];
  const count = Number(snap.seatCount);
  // C2 addendum: fold event-derived anomaly flags (independent of the seat walk).
  const anomalies = await loadAnomalyFlags(bill, snap);
  for (let i = 0; i < count && i < 64; i++) {
    try {
      // Loose-typed read path (artifact JSON is not const-inferred); avoids any.
      const loose = publicClient.readContract as unknown as (p: {
        address: Address;
        abi: unknown;
        functionName: string;
        args: readonly unknown[];
      }) => Promise<unknown>;
      const s = await loose({
        address: bill,
        abi: BillABI,
        functionName: "seats",
        args: [BigInt(i)],
      });
      const arr = Array.isArray(s)
        ? s
        : Object.values((s ?? {}) as Record<string, unknown>);
      const wallet = String(arr[0]) as Address;
      const active = Boolean(arr[2]);
      if (!active) continue;
      rows.push({
        seatId: i,
        wallet,
        active: true,
        confirmed: maskBit(snap.confirmedMask, i),
        postConfirmRotation: anomalies.has(i),
        verified: null,
      });
    } catch {
      /* read failure on one seat never blanks the roster */
    }
  }
  // P0.3 badges: read-only grants view. indexed=true -> ungranted wallets are
  // explicitly "unverified"; feed absent -> every row stays neutral (null).
  // W2.5-4: fold @handle chips from the read-only World username service
  // (usernames.worldcoin.org, GET-only per charter). Fail-soft exactly like
  // loadBadges: any resolution error leaves rows as the chain produced them.
  let rowsWithHandles = rows;
  try {
    const byWallet = await lookupUsernamesForWallets(rows.map((r) => r.wallet));
    rowsWithHandles = rows.map((r) => {
      const rec = byWallet.get(r.wallet.toLowerCase());
      return rec ? { ...r, username: rec.username } : r;
    });
  } catch {
    /* username service down: wallets-only chips, roster stays live */
  }
  return loadBadges(bill, rowsWithHandles);
}

const Badge = ({ seat, mine }: { seat: SeatRow; mine: boolean }) => (
  <span className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
    <span className="break-all">
      #{seat.seatId} {seat.username ? `@${seat.username} · ` : ""}
      {`${seat.wallet.slice(0, 6)}…${seat.wallet.slice(-4)}`}
      {mine && <b className="ml-1">(me)</b>}
    </span>
    <span className="flex shrink-0 gap-1">
      {seat.confirmed && (
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-600">
          ✓ confirmed
        </span>
      )}
      {/* P0.3: one World ID verification badge per seat (t_d1c1cf68). */}
      <SeatBadge status={flagToVerification(seat.verified)} />
      {/* C2 addendum (t_96389deb): post-confirm rotation anomaly chip, event-derived. */}
      {seat.postConfirmRotation && <PostConfirmRotationFlag />}
    </span>
  </span>
);

export const TandaBill = ({
  // W2.5-4 (t_edd4a5e9): invite deep-link pre-probe. The /bill/{address}
  // landing route mounts the SAME shell and auto-probes the bill read-only;
  // home omits the prop and behaves exactly as before.
  initialBill,
}: { initialBill?: Address } = {}) => {
  const [seatInput, setSeatInput] = useState("");
  const [billInput, setBillInput] = useState("");
  const [rotateInput, setRotateInput] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "success" | "failed">(
    "idle",
  );
  const [actionLabel, setActionLabel] = useState("");
  // W2.5-5: the ONE lifecycle owner. sendAction/onClickCreateBill hand it
  // the userOpHash; it drives pending -> mined -> indexed (+terminal
  // failure naming the stuck stage + retry). See lib/useUserOpStatus.ts.
  const lifecycle = useUserOpStatus();
  const handledSeqRef = useRef(0);
  const [status, setStatus] = useState<string>("");
  const [billAddr, setBillAddr] = useState<Address | null>(null);
  const [snap, setSnap] = useState<BillSnapshot | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [nowSec, setNowSec] = useState(0);
  const [expenseAmt, setExpenseAmt] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  // VISUAL-B — pending signature awaiting explicit preview confirmation.
  const [intent, setIntent] = useState<{
    label: string;
    to: Address;
    data: `0x${string}`;
  } | null>(null);
  const intentSummary = (i: {
    label: string;
    to: Address;
    data: `0x${string}`;
  }): IntentSummary => {
    let amount: string | undefined;
    try {
      const outer = decodeFunctionData({
        abi: FactoryABI as unknown as Abi,
        data: i.data,
      });
      if (outer.functionName === "callBill") {
        const inner = decodeFunctionData({
          abi: BillABI as unknown as Abi,
          data: (outer.args as [Address, `0x${string}`])[1],
        });
        const args = (inner.args as readonly unknown[]) ?? [];
        if (
          inner.functionName === "fundEscrow" ||
          inner.functionName === "addExpense"
        ) {
          const big = args[0];
          if (typeof big === "bigint" && big > BigInt(0))
            amount = formatUnits(big, 6);
        }
      } else if (outer.functionName === "approve") {
        const big = (outer.args as readonly unknown[])[1];
        if (typeof big === "bigint") amount = formatUnits(big, 6);
      }
    } catch {
      /* best-effort decode; the verb line still describes the intent */
    }
    return { fn: i.label, amount, target: i.to };
  };
  const onConfirmSign = () => {
    if (!intent) return;
    const i = intent;
    setIntent(null);
    void dispatchAction(i);
  };
  const onCancelSign = () => {
    setIntent(null);
    setStatus("sign cancelled — nothing was sent");
  };
  // fund = approve THEN fundEscrow; amount parked here between the two userOps.
  const pendingFund = useRef<bigint | null>(null);
  // P0.3 badge refresh: latest rows outside render + busy flag for the button.
  const seatsRef = useRef<SeatRow[]>([]);
  const [badgeBusy, setBadgeBusy] = useState(false);

  const session = useSession();
  const myWallet = (
    session.data?.user as { walletAddress?: string } | undefined
  )?.walletAddress?.toLowerCase() as Address | undefined;
  const mySeat = seats.find((s) => s.wallet.toLowerCase() === myWallet);

  const refresh = async (bill: Address) => {
    const p = await probeBill(bill);
    const [rows, block] = await Promise.all([
      fetchSeatRows(bill, p),
      publicClient.getBlock().catch(() => null),
    ]);
    setSnap(p);
    seatsRef.current = rows;
    setSeats(rows);
    if (block) setNowSec(Number(block.timestamp));
    return p;
  };

  // P0.3: badge-only refresh — refetches /api/seat-grants for the probed
  // bill without re-reading chain state; used to flip badges live after a
  // World ID verification lands in the grant index.
  const doRefreshBadges = async () => {
    if (!billAddr) return;
    setBadgeBusy(true);
    try {
      const updated = await loadBadges(billAddr, seatsRef.current);
      seatsRef.current = updated;
      setSeats(updated);
    } finally {
      setBadgeBusy(false);
    }
  };

  const didDeepLink = useRef(false);
  useEffect(() => {
    // W2.5-4: invite-landing auto-probe. Single-shot (StrictMode-safe),
    // read-only lane — every write still requires the normal in-app gates.
    if (!initialBill || didDeepLink.current) return;
    didDeepLink.current = true;
    setBillAddr(initialBill);
    void (async () => {
      setStatus("probing invited bill…");
      try {
        await refresh(initialBill);
        // Audit item 1 (Flux ruling): a settled bill must show its outcome,
        // never a perpetual "probing" state.
        let settled = false;
        try {
          const f = await fetch(`/api/settlements?bill=${initialBill}&page=1`, {
            cache: "no-store",
          }).then((r) => (r.ok ? r.json() : null));
          settled = (f?.settlements?.length ?? 0) > 0;
        } catch {
          /* status stays outcome-less, never wrong */
        }
        setStatus(settled ? "Settled — payouts released on-chain" : "");
      } catch (e) {
        setStatus(
          `invite bill probe failed: ${(e as Error).message.slice(0, 120)}`,
        );
      }
    })();
  }, [initialBill]);

  // W2.5-5 — lifecycle terminal handler: applies each completed op EXACTLY
  // once (handledSeqRef gates on snapshot.seq so retry() re-applies only when
  // the re-run NEWLY terminates). Failure text always NAMES the stuck stage
  // (relayer|indexer) — eternal pending is a defect with a name, never an
  // endless spinner.
  useEffect(() => {
    const s = lifecycle.snapshot;
    if (!s.terminal || s.seq <= handledSeqRef.current) return;
    handledSeqRef.current = s.seq;
    if (s.stage === "failed") {
      setState("failed");
      setStatus(stuckMessage(s));
      pendingFund.current = null;
      return;
    }
    // `indexed`, or `mined` with no indexer lane (approve class) — success.
    setState("success");
    setStatus(`${actionLabel || "createBill"} — ${stageCaption(s)}`);
    if (actionLabel === "approve" && pendingFund.current !== null && billAddr) {
      const amt = pendingFund.current;
      pendingFund.current = null;
      const a2 = billAction(billAddr, TANDA.factory, "fundEscrow", [amt]);
      void sendAction("fundEscrow", a2.to, a2.data);
    }
    if (s.billAddress) {
      const landed = s.billAddress as Address;
      setBillAddr(landed);
      void refresh(landed);
    } else if (billAddr) {
      void refresh(billAddr);
    }
    // Intentional: refresh() is re-created per render and billAddr/landed are
    // read-through of the snapshot that IS the trigger; adding them re-fires on
    // every keystroke (Kaizen t_5de0a4ab justification, 2026-11-22).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle.snapshot]);

  // W2.5-4: seats may be 0x addresses OR @handles (World usernames). Handles
  // resolve through the read-only username service into checksummed wallets
  // BEFORE the createBill userOp is built — the contract still only ever
  // receives valid addresses; the state machine is untouched.
  const resolveSeats = async (): Promise<Address[]> => {
    const { addresses, handles, invalid } = parseSeatTokens(seatInput);
    if (invalid.length)
      throw new Error(
        `seats: unrecognized token(s): ${invalid.slice(0, 3).join(", ")}`,
      );
    if (!handles.length) {
      if (!addresses.length)
        throw new Error("seats: at least one address or @handle required");
      return addresses;
    }
    const byHandle = await resolveWalletsForHandles(handles);
    const missing = handles.filter((h) => !byHandle.has(h));
    if (missing.length)
      throw new Error(
        `seats: no World username for @${missing.slice(0, 3).join(", @")}`,
      );
    return [...addresses, ...handles.map((h) => byHandle.get(h)!.address)];
  };

  // VISUAL-B (t_d3455bc6) — Phantom-class preview-before-sign gate. EVERY
  // money-path signature (incl. the approve->fundEscrow chained op, which is
  // a SEPARATE userOp) surfaces a ConfirmPreview first; the userOp is only
  // ever built and sent on explicit confirm. Cancel sends nothing.
  const sendAction = async (
    label: string,
    to: Address,
    data: `0x${string}`,
  ) => {
    setIntent({ label, to, data });
  };
  const dispatchAction = async (i: {
    label: string;
    to: Address;
    data: `0x${string}`;
  }) => {
    const { label, to, data } = i;
    setState("pending");
    setActionLabel(label);
    setStatus("");
    try {
      const result = await MiniKit.sendTransaction({
        chainId: TANDA.chainId,
        transactions: [{ to, data }],
      });
      if (!result.data?.userOpHash) throw new Error("No userOpHash returned");
      // W2.5-5: hand the hash to the lifecycle machine (pending -> mined
      // -> indexed). Bill-scoped ops pass `bill` so the indexed proof comes
      // from the settlement_events ledger; ERC-20 `approve` has no indexer
      // lane and routes to the honest by-userop no_event terminal at mined.
      lifecycle.track(
        result.data.userOpHash,
        label !== "approve" && billAddr ? { bill: billAddr } : {},
      );
    } catch (err) {
      console.error(err);
      setState("failed");
      setStatus(`${label} failed: ${(err as Error).message.slice(0, 100)}`);
    }
  };

  const onClickCreateBill = async () => {
    setStatus("");
    setState("pending");
    // W2.5-4: resolve @handles -> wallets first; a bad token aborts BEFORE
    // any userOp is built (no wasted signature prompt, no on-chain revert).
    let seatsList: Address[];
    try {
      seatsList = await resolveSeats();
    } catch (err) {
      setState("idle");
      setStatus((err as Error).message.slice(0, 160));
      return;
    }
    try {
      const result = await MiniKit.sendTransaction({
        chainId: TANDA.chainId,
        transactions: [
          {
            to: TANDA.factory,
            data: encodeFunctionData({
              abi: FactoryABI,
              functionName: "createBill",
              // W6-V2 canonical token = USDC on this chain; seats = initial roster
              // (factory passes it into initialize atomically — child onlyOwner trap).
              args: [TANDA.usdcSepolia as Address, seatsList],
            }),
          },
        ],
      });
      if (!result.data?.userOpHash) throw new Error("No userOpHash returned");
      // No `bill` yet BY DESIGN: the createBill address ARRIVES via the
      // indexed snapshot (by-userop lane -> bill_address), applied in the
      // terminal handler above — no separate decode dead-end.
      lifecycle.track(result.data.userOpHash);
    } catch (err) {
      console.error(err);
      setState("failed");
    }
  };

  const onClickProbeBill = async () => {
    if (!isAddress(billInput)) {
      setStatus("invalid bill address");
      return;
    }
    setStatus("probing…");
    try {
      const p = await refresh(billInput as Address);
      setBillAddr(billInput as Address);
      setStatus(
        `era=${p.era} token=${p.token} window=${p.window}s maxHold=${p.maxHold}s ` +
          `escrow=${p.escrow} seats=${p.seatCount} | ${p.lastSettlement}`,
      );
    } catch (e) {
      setStatus(`probe failed: ${(e as Error).message.slice(0, 120)}`);
    }
  };

  // --- W10 action gates (mirrors frozen contract semantics; contract is truth) ---
  const forwarderEra = snap !== null && snap.era === "factory-w10";
  const initiated = snap !== null && snap.initiatedAt > BigInt(0);
  const executable =
    snap !== null &&
    forwarderEra &&
    snap.fullyConfirmedAt > BigInt(0) &&
    snap.settledAt === BigInt(0) &&
    nowSec >= Number(snap.fullyConfirmedAt + snap.window);
  const mineConfirmed = mySeat ? mySeat.confirmed : false;
  // Split-lock HINT only (C6/C7 enforced on-chain): self-rotation of a seat that
  // already confirmed while a settlement is in flight reverts until it resolves.
  const rotateLocked =
    snap !== null &&
    mineConfirmed &&
    initiated &&
    snap.settledAt === BigInt(0) &&
    !snap.refunded &&
    nowSec < Number(snap.initiatedAt + snap.maxHold);

  // P1.1b render lane (t_p11b_nudge_render): derive the nudge landing state
  // (refund/execute countdown — the exact moments N2b/N2c/N3a push about)
  // from the same probed snapshot the gates above read. No new RPC, no new
  // state, pure derivation; nowSec is 0 until the first probe lands a block
  // timestamp, so nothing renders on a cold mount.
  const nudge = snap !== null && nowSec > 0 ? nudgeStatus(snap, nowSec) : null;
  const escrowUSDC =
    snap !== null &&
    snap.era !== "unknown" &&
    snap.era !== "legacy" &&
    snap.escrow > BigInt(0)
      ? formatUnits(snap.escrow, 6)
          .replace(/(\.\d*?)0+$/, "$1")
          .replace(/\.$/, "")
      : undefined;
  // P1.4b: settlement payout vector (factory era only — legacy never populates
  // settlementTotal/expectedMask, so it stays null there). A build throw means
  // inputs cannot be explained faithfully -> render nothing, never a partial
  // table (contract-builder doctrine). rotationAnomaly omitted: the UI has no
  // SeatWalletRotated event feed; anomaly sentences arrive with that lane.
  let settlementVector: SettlementVector | null = null;
  if (initiated && snap !== null && snap.settlementTotal > BigInt(0)) {
    try {
      settlementVector = buildSettlementVector({
        settlementId: BigInt(0),
        totalAmount: snap.settlementTotal,
        expectedMask: snap.expectedMask,
        seats: seats.map((s) => ({ seatId: s.seatId, wallet: s.wallet })),
      });
    } catch {
      /* unfaithful inputs — omit the vector table */
    }
  }

  const doConfirm = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, "confirmSettlement", [
      BigInt(0),
    ]);
    void sendAction("confirmSettlement", a.to, a.data);
  };
  const doExecute = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, "executeSettlement", [
      BigInt(0),
    ]);
    void sendAction("executeSettlement", a.to, a.data);
  };
  const doRotate = () => {
    if (!billAddr || !mySeat || !isAddress(rotateInput)) {
      setStatus("rotate: your seat + a valid new wallet required");
      return;
    }
    const a = billAction(billAddr, TANDA.factory, "rotateSeatWallet", [
      BigInt(mySeat.seatId),
      rotateInput as Address,
    ]);
    void sendAction("rotateSeatWallet", a.to, a.data);
  };

  // --- Owner console (frozen V2 semantics; every write through billAction,
  //     the ONE sanctioned approve path is usdcApprove: to=USDC, spender=clone) ---
  const isOwner =
    snap !== null &&
    myWallet !== undefined &&
    snap.owner.toLowerCase() === myWallet.toLowerCase();
  const parseAmt = (s: string): bigint | null => {
    try {
      // Canonical token is 6-decimal USDC on this chain (frozen; no dynamic
      // decimals probe on the write path — amount intent is owner-typed).
      const v = parseUnits(s.trim(), 6);
      return v > BigInt(0) ? v : null;
    } catch {
      return null;
    }
  };
  const doAddExpense = () => {
    if (!billAddr) return;
    const amt = parseAmt(expenseAmt);
    if (amt === null) {
      setStatus("expense: positive USDC amount required");
      return;
    }
    const a = billAction(billAddr, TANDA.factory, "addExpense", [amt]);
    void sendAction("addExpense", a.to, a.data);
  };
  const doFund = () => {
    if (!billAddr) return;
    const amt = parseAmt(fundAmt);
    if (amt === null) {
      setStatus("fund: positive USDC amount required");
      return;
    }
    pendingFund.current = amt;
    const ap = usdcApprove(TANDA.usdcSepolia, billAddr, amt);
    void sendAction("approve", ap.to, ap.data);
  };
  const doInitiate = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, "initiateSettlement", []);
    void sendAction("initiateSettlement", a.to, a.data);
  };
  const doRefund = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, "refundSettlement", [
      BigInt(0),
    ]);
    void sendAction("refundSettlement", a.to, a.data);
  };

  const verifiedCount = seats.filter((s) => s.verified === true).length;
  const unverifiedCount = seats.filter((s) => s.verified === false).length;
  const unknownCount = seats.filter((s) => s.verified == null).length;
  const confirmedCount = seats.filter((s) => s.confirmed).length;

  return (
    <div className="grid w-full gap-4 rounded-xl border p-4">
      <p className="text-lg font-semibold">
        Tanda Bill · World Chain Sepolia
      </p>
      <p className="text-xs opacity-70">
        Funded means funded. USDC sits in escrow from day one. When everyone
        confirms, money moves — nobody can ghost your payout.
      </p>
      <input
        className="rounded border p-2 text-sm"
        placeholder="seat addresses, comma-separated (0x…,0x…)"
        value={seatInput}
        onChange={(e) => setSeatInput(e.target.value)}
      />
      <LiveFeedback
        label={{
          failed: "Transaction failed",
          pending: "Transaction pending",
          success: "UserOp confirmed on-chain",
        }}
        state={state === "idle" ? undefined : state}
        className="w-full"
      >
        <Button
          onClick={onClickCreateBill}
          disabled={state === "pending"}
          size="lg"
          className="w-full"
        >
          Start a guaranteed bill
        </Button>
      </LiveFeedback>
      <input
        className="rounded border p-2 text-sm"
        placeholder="bill address to probe (factory clone or legacy direct)"
        value={billInput}
        onChange={(e) => setBillInput(e.target.value)}
      />
      <Button onClick={onClickProbeBill} variant="secondary">
        Probe Bill (era + roster)
      </Button>
      {intent && (
        <ConfirmPreview
          summary={intentSummary(intent)}
          onConfirm={onConfirmSign}
          onCancel={onCancelSign}
        />
      )}
      {status && <p className="break-all text-xs opacity-70">{status}</p>}
      {/* W2.5-5 — the user always sees WHICH stage the pipeline is at. A
          stuck op NAMES the stage (relayer|indexer) and offers retry:
          eternal pending is a defect, never an endless spinner. */}
      {lifecycle.isTracking && (
        <p className="text-xs opacity-60" data-testid="lifecycle-stage">
          {stageCaption(lifecycle.snapshot)}
        </p>
      )}
      {lifecycle.stage === "failed" && (
        <div className="flex flex-wrap items-center gap-2 rounded border p-2 border-red-500/40">
          <p
            className="break-all text-xs text-red-500"
            data-testid="lifecycle-stuck"
          >
            {stuckMessage(lifecycle.snapshot)}
          </p>
          <Button onClick={lifecycle.retry} variant="secondary" size="sm">
            Retry tracking
          </Button>
        </div>
      )}

      {snap && snap.era !== "unknown" && billAddr && (
        <div className="grid gap-2 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold opacity-80">
              Roster — {verifiedCount} World ID verified · {unverifiedCount}{" "}
              unverified
              {unknownCount > 0 ? ` · ${unknownCount} unknown` : ""} ·{" "}
              {confirmedCount}/{seats.length} confirmed
            </p>
            <Button
              onClick={() => void doRefreshBadges()}
              variant="tertiary"
              size="sm"
              disabled={badgeBusy}
            >
              {badgeBusy ? "Refreshing badges…" : "Refresh badges"}
            </Button>
          </div>
          <div className="grid gap-1">
            {seats.map((s) => (
              <Badge
                key={s.seatId}
                seat={s}
                mine={s.wallet.toLowerCase() === myWallet}
              />
            ))}
          </div>

          {/* W2-F1 (t_92a43849): the REAL seat join — proofOfHuman bound to
              bill:wallet; verify-proof enforces the keccak binding and writes
              seat_grants through the indexer. onVerified refreshes badges so
              the seat flips verified the moment the grant lands. */}
          {myWallet && (
            <Verify
              action={SEAT_JOIN_ACTION}
              seat={{ bill: billAddr, wallet: myWallet }}
              onVerified={() => void doRefreshBadges()}
            />
          )}

          {/* W2.5-4 (t_edd4a5e9): one-tap invite — universal deep link onto
              this bill's /bill/{address} landing inside World App. */}
          <InvitePanel
            bill={billAddr}
            ownerUsername={
              (session.data?.user as { username?: string })?.username
            }
            usdc={escrowUSDC}
          />

          {/* P1.1b: the cadence-nudge landing state the push promised. */}
          {nudge !== null && (
            <NudgeCountdown status={nudge} usdc={escrowUSDC} />
          )}
          {settlementVector && (
            <SettlementVectorTable vector={settlementVector} />
          )}

          {forwarderEra && initiated && mySeat && !mineConfirmed && (
            <div className="grid gap-1">
              <p className="text-xs opacity-70">
                Your share is already in the contract. Confirming just says yes
                — it can&apos;t be un-funded.
              </p>
              <Button
                onClick={doConfirm}
                variant="secondary"
                size="sm"
                disabled={state === "pending"}
              >
                Confirm my seat
              </Button>
            </div>
          )}
          {executable && (
            <Button
              onClick={doExecute}
              variant="secondary"
              size="sm"
              disabled={state === "pending"}
            >
              Settle now (permissionless)
            </Button>
          )}
          {forwarderEra && mySeat && (
            <div className="grid gap-1">
              <input
                className="rounded border p-2 text-xs"
                placeholder={`new seat wallet (replacing ${mySeat.wallet.slice(0, 10)}…)`}
                value={rotateInput}
                onChange={(e) => setRotateInput(e.target.value)}
              />
              <Button
                onClick={doRotate}
                variant="secondary"
                size="sm"
                disabled={
                  state === "pending" || rotateLocked || !isAddress(rotateInput)
                }
              >
                {rotateLocked
                  ? "Rotation locked (settlement in flight)"
                  : "Rotate my wallet"}
              </Button>
            </div>
          )}
          {forwarderEra && isOwner && (
            <div className="grid gap-1 border-t border-dashed pt-2">
              <p className="text-xs font-semibold opacity-70">Owner console</p>
              <div className="flex gap-1">
                <input
                  className="w-full rounded border p-2 text-xs"
                  placeholder="expense USDC (e.g. 12.50)"
                  value={expenseAmt}
                  onChange={(e) => setExpenseAmt(e.target.value)}
                />
                <Button
                  onClick={doAddExpense}
                  variant="secondary"
                  size="sm"
                  disabled={
                    state === "pending" ||
                    (initiated &&
                      snap !== null &&
                      snap.settledAt === BigInt(0) &&
                      !snap.refunded)
                  }
                >
                  Add expense
                </Button>
              </div>
              <div className="flex gap-1">
                <input
                  className="w-full rounded border p-2 text-xs"
                  placeholder="fund USDC (approve → escrow)"
                  value={fundAmt}
                  onChange={(e) => setFundAmt(e.target.value)}
                />
                <Button
                  onClick={doFund}
                  variant="secondary"
                  size="sm"
                  disabled={state === "pending" || parseAmt(fundAmt) === null}
                >
                  Fund escrow
                </Button>
              </div>
              {snap.escrow > BigInt(0) && (
                <p className="text-xs opacity-70">
                  Escrow locked — the math is done, the money&apos;s already
                  here.
                </p>
              )}
              {!initiated && (
                <Button
                  onClick={doInitiate}
                  variant="secondary"
                  size="sm"
                  disabled={state === "pending"}
                >
                  Initiate settlement
                </Button>
              )}
              {initiated &&
                snap !== null &&
                snap.settledAt === BigInt(0) &&
                !snap.refunded && (
                  <Button
                    onClick={doRefund}
                    variant="tertiary"
                    size="sm"
                    disabled={state === "pending"}
                  >
                    Refund settlement (bounded escape)
                  </Button>
                )}
            </div>
          )}
          {snap.settledAt > BigInt(0) && (
            <p className="text-xs font-semibold opacity-80">
              Settled on-chain. No IOUs, no reminders needed, no begging.
            </p>
          )}
          {snap.era === "legacy" && (
            <p className="text-xs opacity-60">
              Legacy W5 clone — runtime-locked; read-only here (no forwarder, no
              rotation).
            </p>
          )}
          {snap.era === "factory-v2" && (
            <p className="text-xs opacity-60">
              Pre-forwarder V2 clone — rotation unavailable on this lineage.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
