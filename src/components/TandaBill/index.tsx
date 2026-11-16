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
// W10 slice: ALL bill writes route through factory.callBill (billAction helper) —
// clones are never targets (MiniKit invalid_contract gate). P0.3 badge feed reads
// /api/seat-grants (read-only indexer view; absent table = neutral chips).
import FactoryABI from '@/abi/TandaBillFactory.json';
import BillABI from '@/abi/TandaBillV2.json';
import BillV1ABI from '@/abi/TandaBillV1.json';
import { TANDA } from '@/config/tanda';
import { billAction, maskBit, type SeatRow } from '@/lib/billActions';
import { Button, LiveFeedback } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { useWaitForUserOperationReceipt } from '@worldcoin/minikit-react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { worldchainSepolia } from 'viem/chains';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
} from 'viem';

type Era = 'factory-w10' | 'factory-v2' | 'legacy' | 'unknown';

const ZERO: Address = '0x0000000000000000000000000000000000000000';

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
  fullyConfirmedAt: bigint;
  refunded: boolean;
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
    era: 'unknown', token: ZERO, window: BigInt(0), maxHold: BigInt(0),
    escrow: BigInt(0), seatCount: BigInt(0), lastSettlement: 'no code at address',
    initiatedAt: BigInt(0), settledAt: BigInt(0), confirmedMask: BigInt(0),
    fullyConfirmedAt: BigInt(0), refunded: false,
  };
  const code = await publicClient.getCode({ address: bill });
  if (!code || code === '0x') return blank;
  // W10 multi-factory era detect: whichever KNOWN_FACTORY registered the clone
  // decides lineage; a readable factory() getter on the bill marks the
  // rotate-capable forwarder era (pre-W10 clones revert it -> factory-v2).
  let mintedBy: Address | null = null;
  const isClone = code.length === 92; // EIP-1167 runtime = 45 B (0x + 90 hex)
  for (let attempt = 0; attempt < (isClone ? 4 : 1) && !mintedBy; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200)); // replica-lag guard: a bill minted seconds ago may read isBill=false on stale replicas
    for (const f of TANDA.knownFactories) {
      const isB = await publicClient
        .readContract({ address: f, abi: FactoryABI, functionName: 'isBill', args: [bill] })
        .catch(() => false);
      if (isB) { mintedBy = f; break; }
    }
  }
  let rotationCapable = false;
  if (mintedBy) {
    rotationCapable = await publicClient
      .readContract({ address: bill, abi: BillABI, functionName: 'factory' })
      .then(() => true)
      .catch(() => false);
  }
  const isFactoryBill = mintedBy !== null;
  const era: Era = !isFactoryBill ? 'legacy' : rotationCapable ? 'factory-w10' : 'factory-v2';
  const abi = isFactoryBill ? BillABI : BillV1ABI;
  const read = <T,>(fn: string, args: readonly unknown[] = []): Promise<T> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient.readContract({ address: bill, abi, functionName: fn, args } as any) as Promise<T>;
  const snap: BillSnapshot = { ...blank, era };
  snap.token = await read<Address>('token');
  snap.window = await read<bigint>('SETTLEMENT_WINDOW');
  snap.escrow = await read<bigint>('escrowBalance');
  snap.seatCount = await read<bigint>('activeSeatCount');
  const total = await read<bigint>('totalExpenses');
  snap.lastSettlement = `expenses=${total} (none initiated)`;
  if (isFactoryBill) {
    snap.maxHold = await read<bigint>('MAX_HOLD');
    try {
      // tuple order (frozen ABI): totalAmount, settledAt, initiatedAt,
      // expectedMask, confirmedMask, fullyConfirmedAt, refunded
      const s = await read<[bigint, bigint, bigint, bigint, bigint, bigint, boolean]>('settlements', [0]);
      const payouts = await read<bigint[]>('settlementPayouts', [0]);
      snap.settledAt = s[1];
      snap.initiatedAt = s[2];
      snap.confirmedMask = s[4];
      snap.fullyConfirmedAt = s[5];
      snap.refunded = s[6];
      snap.lastSettlement =
        `set#0 7-tuple total=${s[0]} initiatedAt=${s[2]} fullyConfirmedAt=${s[5]} ` +
        `(V2 execute gate=fullyConfirmedAt+WINDOW; refund escape=initiatedAt+MAX_HOLD; settled=${s[1]}) ` +
        `mask=${s[4]}/${s[3]} refunded=${s[6]} payouts=${payouts.length}`;
    } catch { /* no settlements yet */ }
  } else {
    // W5 era: 3 outputs only — payouts never existed, MAX_HOLD absent (escape
    // hatch is V2-only). V1 execute gate = initiatedAt + WINDOW (no fullyConfirmedAt).
    try {
      const s = await read<[bigint, bigint, bigint]>('settlements', [0]);
      snap.settledAt = s[1];
      snap.initiatedAt = s[2];
      snap.lastSettlement = `set#0 LEGACY 3-tuple total=${s[0]} settledAt=${s[1]} initiatedAt=${s[2]} (V1 execute gate=initiatedAt+WINDOW)`;
    } catch { /* no settlements yet */ }
  }
  return snap;
}

/** Active seat roster via seats(i) walk (swap-pop removal keeps indices dense;
 *  seatIdOf maps wallet -> index; confirmed bit from settlement mask). */
async function fetchSeatRows(bill: Address, snap: BillSnapshot): Promise<SeatRow[]> {
  if (snap.era === 'unknown' || snap.era === 'legacy') return [];
  const rows: SeatRow[] = [];
  const count = Number(snap.seatCount);
  for (let i = 0; i < count && i < 64; i++) {
    try {
      // Loose-typed read path (artifact JSON is not const-inferred); avoids any.
      const loose = publicClient.readContract as unknown as (p: {
        address: Address; abi: unknown; functionName: string; args: readonly unknown[];
      }) => Promise<unknown>;
      const s = await loose({
        address: bill, abi: BillABI, functionName: 'seats', args: [BigInt(i)],
      });
      const arr = Array.isArray(s) ? s : Object.values((s ?? {}) as Record<string, unknown>);
      const wallet = String(arr[0]) as Address;
      const active = Boolean(arr[2]);
      if (!active) continue;
      rows.push({
        seatId: i,
        wallet,
        active: true,
        confirmed: maskBit(snap.confirmedMask, i),
        verified: null,
      });
    } catch { /* read failure on one seat never blanks the roster */ }
  }
  // P0.3 badges: read-only grants view. indexed=true -> ungranted wallets are
  // explicitly "unindexed"; feed absent -> every row stays neutral (null).
  try {
    const res = await fetch(`/api/seat-grants?bill=${bill}`);
    if (res.ok) {
      const body = await res.json() as { grants?: Record<string, unknown>; indexed?: boolean };
      const grants = body.grants ?? {};
      for (const r of rows) {
        r.verified = r.wallet.toLowerCase() in grants ? true : body.indexed === true ? false : null;
      }
    }
  } catch { /* badge feed down: neutral chips, roster stays live */ }
  return rows;
}

const Badge = ({ seat, mine }: { seat: SeatRow; mine: boolean }) => (
  <span className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
    <span className="break-all">
      #{seat.seatId} {`${seat.wallet.slice(0, 6)}…${seat.wallet.slice(-4)}`}
      {mine && <b className="ml-1">(me)</b>}
    </span>
    <span className="flex shrink-0 gap-1">
      {seat.confirmed && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-600">✓ confirmed</span>}
      {seat.verified === true && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-600">⬡ human</span>}
      {seat.verified === false && <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-slate-500">unindexed</span>}
      {seat.verified === null && <span className="rounded bg-slate-500/10 px-1.5 py-0.5 text-slate-400">no badge feed</span>}
    </span>
  </span>
);

export const TandaBill = () => {
  const [seatInput, setSeatInput] = useState('');
  const [billInput, setBillInput] = useState('');
  const [rotateInput, setRotateInput] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [actionLabel, setActionLabel] = useState('');
  const [userOpHash, setUserOpHash] = useState('');
  const [status, setStatus] = useState<string>('');
  const [billAddr, setBillAddr] = useState<Address | null>(null);
  const [snap, setSnap] = useState<BillSnapshot | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [nowSec, setNowSec] = useState(0);

  const session = useSession();
  const myWallet = (session.data?.user as { walletAddress?: string } | undefined)
    ?.walletAddress?.toLowerCase() as Address | undefined;
  const mySeat = seats.find((s) => s.wallet.toLowerCase() === myWallet);

  const { isLoading, isSuccess, isError } = useWaitForUserOperationReceipt({
    client: publicClient, userOpHash,
  });

  const refresh = async (bill: Address) => {
    const p = await probeBill(bill);
    const [rows, block] = await Promise.all([
      fetchSeatRows(bill, p),
      publicClient.getBlock().catch(() => null),
    ]);
    setSnap(p);
    setSeats(rows);
    if (block) setNowSec(Number(block.timestamp));
    return p;
  };

  useEffect(() => {
    if (isSuccess && userOpHash) {
      // NOTE (arch leg): userOpHash != eth tx hash; BillCreated decode belongs in
      // a backend/indexer or via MiniKit wallet-auth receipt lookup — staged lane
      // reports confirmation only.
      setState('success');
      setStatus(`${actionLabel || 'createBill'} confirmed — refreshing chain state`);
      setUserOpHash('');
      if (billAddr) void refresh(billAddr);
    } else if (isError && userOpHash) {
      setState('failed');
      setUserOpHash('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, isSuccess]);

  const parseSeats = (): Address[] => {
    const seatsIn = seatInput.split(/[\s,]+/).filter(Boolean) as Address[];
    if (!seatsIn.length || !seatsIn.every((s) => isAddress(s))) throw new Error('seats: comma-separated valid addresses required');
    return seatsIn;
  };

  const sendAction = async (label: string, to: Address, data: `0x${string}`) => {
    setState('pending');
    setActionLabel(label);
    setStatus('');
    try {
      const result = await MiniKit.sendTransaction({
        chainId: TANDA.chainId,
        transactions: [{ to, data }],
      });
      if (!result.data?.userOpHash) throw new Error('No userOpHash returned');
      setUserOpHash(result.data.userOpHash);
    } catch (err) {
      console.error(err);
      setState('failed');
      setStatus(`${label} failed: ${(err as Error).message.slice(0, 100)}`);
    }
  };

  const onClickCreateBill = async () => {
    setStatus('');
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
  const forwarderEra = snap !== null && snap.era === 'factory-w10';
  const initiated = snap !== null && snap.initiatedAt > BigInt(0);
  const executable = snap !== null && forwarderEra &&
    snap.fullyConfirmedAt > BigInt(0) && snap.settledAt === BigInt(0) &&
    nowSec >= Number(snap.fullyConfirmedAt + snap.window);
  const mineConfirmed = mySeat ? mySeat.confirmed : false;
  // Split-lock HINT only (C6/C7 enforced on-chain): self-rotation of a seat that
  // already confirmed while a settlement is in flight reverts until it resolves.
  const rotateLocked = snap !== null && mineConfirmed && initiated &&
    snap.settledAt === BigInt(0) && !snap.refunded &&
    nowSec < Number(snap.initiatedAt + snap.maxHold);

  const doConfirm = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, 'confirmSettlement', [BigInt(0)]);
    void sendAction('confirmSettlement', a.to, a.data);
  };
  const doExecute = () => {
    if (!billAddr) return;
    const a = billAction(billAddr, TANDA.factory, 'executeSettlement', [BigInt(0)]);
    void sendAction('executeSettlement', a.to, a.data);
  };
  const doRotate = () => {
    if (!billAddr || !mySeat || !isAddress(rotateInput)) { setStatus('rotate: your seat + a valid new wallet required'); return; }
    const a = billAction(billAddr, TANDA.factory, 'rotateSeatWallet', [BigInt(mySeat.seatId), rotateInput as Address]);
    void sendAction('rotateSeatWallet', a.to, a.data);
  };

  const verifiedCount = seats.filter((s) => s.verified === true).length;
  const confirmedCount = seats.filter((s) => s.confirmed).length;

  return (
    <div className="grid w-full gap-4 rounded-xl border p-4">
      <p className="text-lg font-semibold">Tanda Bill (W8 shell — chain {TANDA.chainId})</p>
      <p className="text-xs opacity-70">
        Funded means funded — USDC sits in escrow from day one. When everyone
        confirms, money moves; nobody can ghost a payout.
      </p>
      <input
        className="rounded border p-2 text-sm"
        placeholder="seat addresses, comma-separated (0x…,0x…)"
        value={seatInput}
        onChange={(e) => setSeatInput(e.target.value)}
      />
      <LiveFeedback
        label={{
          failed: 'Transaction failed',
          pending: 'Transaction pending',
          success: 'UserOp confirmed on-chain',
        }}
        state={state === 'idle' ? undefined : state}
        className="w-full"
      >
        <Button onClick={onClickCreateBill} disabled={state === 'pending'} size="lg" className="w-full">
          Start a guaranteed bill
        </Button>
      </LiveFeedback>
      <input
        className="rounded border p-2 text-sm"
        placeholder="bill address to probe (factory clone or legacy direct)"
        value={billInput}
        onChange={(e) => setBillInput(e.target.value)}
      />
      <Button onClick={onClickProbeBill} variant="secondary">Probe Bill (era + roster)</Button>
      {status && <p className="break-all text-xs opacity-70">{status}</p>}
      {isLoading && <p className="text-xs opacity-60">waiting for userOp receipt…</p>}

      {snap && snap.era !== 'unknown' && billAddr && (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs font-semibold opacity-80">
            Roster — {verifiedCount} verified humans · {confirmedCount}/{seats.length} confirmed
          </p>
          <div className="grid gap-1">
            {seats.map((s) => (
              <Badge key={s.seatId} seat={s} mine={s.wallet.toLowerCase() === myWallet} />
            ))}
          </div>

          {forwarderEra && initiated && mySeat && !mineConfirmed && (
            <Button onClick={doConfirm} variant="secondary" size="sm" disabled={state === 'pending'}>
              Confirm my seat
            </Button>
          )}
          {executable && (
            <Button onClick={doExecute} variant="secondary" size="sm" disabled={state === 'pending'}>
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
              <Button onClick={doRotate} variant="secondary" size="sm"
                disabled={state === 'pending' || rotateLocked || !isAddress(rotateInput)}>
                {rotateLocked ? 'Rotation locked (settlement in flight)' : 'Rotate my wallet'}
              </Button>
            </div>
          )}
          {snap.era === 'legacy' && (
            <p className="text-xs opacity-60">
              Legacy W5 clone — runtime-locked; read-only here (no forwarder, no rotation).
            </p>
          )}
          {snap.era === 'factory-v2' && (
            <p className="text-xs opacity-60">
              Pre-forwarder V2 clone — rotation unavailable on this lineage.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
