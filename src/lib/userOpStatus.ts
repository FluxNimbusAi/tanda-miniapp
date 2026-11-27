// W2.5-5 — userOp lifecycle GOLDEN PATH (pure, isomorphic, zero React).
// This module is the ONE state machine the app ships for async-relayer
// reality: pending -> mined -> indexed, with an EXPLICIT terminal failure
// that NAMES the stage it's stuck at (eternal-pending is a defect, not a
// spinner). Both consumers import THIS file — the hook (src/lib/
// useUserOpStatus.ts, client) and the P-A E2E runner (e2e/lifecycle_leg.mts,
// node) — so hook and runner provably share one golden path (OPP-003
// Dead-end 1 fix shape; Flux-approved standalone).
//
// Stage owners / ground truth:
//   pending  — MiniKit.sendTransaction returned a userOpHash; World's
//              relayer endpoint /api/v2/minikit/transaction/{id} is polled
//              (via same-origin proxy route; budget 60s mirrors :8096's
//              POLL_INTERVAL 2s x POLL_MAX 30 W8 ceiling).
//   mined    — relayer reports completed/success (receipt exists on-chain);
//              txHash arrives here.
//   indexed  — the :8096 bill indexer (services/bill_index.py) confirms the
//              canonical landing: /bills/by-userop/{h} row success
//              (+bill_address), OR — when the relayer already gave us the
//              txHash and the caller passed a bill — the settlement_events
//              ledger contains that tx (bill-scoped ops like confirm/
//              initiate, which carry no BillCreated event).
//   failed   — terminal. stuckAt ∈ {relayer, indexer} + reason ALWAYS set:
//              relayer said failed, a budget expired, or the indexer
//              rejected/timed out a mined tx. The UI renders the stuck
//              stage name verbatim and offers retry (retry re-runs the same
//              golden path against the same userOpHash — relayers are
//              eventually-consistent, the hash is immutable).
//   mined+indexedNa — terminal SUCCESS with no indexed stage: ERC-20
//              approve (and any tx whose class has nothing to index). This
//              is HONEST naming, never a fake "indexed" tick.

export type Stage = 'idle' | 'pending' | 'mined' | 'indexed' | 'failed';

/** Which layer the user is stuck at — the exact word the UI must show. */
export type StuckStage = 'relayer' | 'indexer';

export type RelayerPoll =
  | { relayer: 'pending' }
  | { relayer: 'completed'; txHash?: string }
  | { relayer: 'failed'; detail: string };

export type IndexProbe =
  | { index: 'pending' }
  | { index: 'success'; billAddress?: string; txHash?: string }
  /** Mined tx carries no BillCreated event (approve-class or bill-scoped op
   *  that the ledger never saw): terminal at mined, indexed stage N/A. */
  | { index: 'no_event' }
  | { index: 'failed'; detail: string };

export type LifecycleSnapshot = {
  stage: Stage;
  userOpHash: string;
  txHash?: string;
  billAddress?: string;
  /** Set iff stage === 'failed' — the stage name the UI displays. */
  stuckAt?: StuckStage;
  reason?: string;
  /** true when this tx class has no indexed lane (terminal at mined). */
  indexedNa?: boolean;
  /** Terminal snapshots stop polling; consumers gate one-shot effects on this. */
  terminal: boolean;
  /** polls executed so far (both phases) — budget observability. */
  polls: number;
  /** monotonic op-instance id; retry()/re-track bumps it. One-shot effect
   *  handlers key off (terminal, seq) so an op is never double-applied. */
  seq: number;
};

export const IDLE_SNAPSHOT: LifecycleSnapshot = {
  stage: 'idle',
  userOpHash: '',
  terminal: false,
  polls: 0,
  seq: 0,
};

export type LifecycleDeps = {
  userOpHash: string;
  /** One GET against /api/v2/minikit/transaction/{id} (already normalized).
   *  Throw = transient: the loop keeps polling until the pending budget. */
  pollTx: (userOpHash: string) => Promise<RelayerPoll>;
  /** Indexed oracle; omit = tx class has no indexer lane (terminal at mined).
   *  txHash is the value mined delivered (may be undefined if the relayer
   *  body omitted it — probes must degrade to the by-userop lane). */
  probeIndex?: (userOpHash: string, txHash?: string) => Promise<IndexProbe>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  /** W8 ceiling: 2s x 30 (~60s) — eternal pending past this is terminal. */
  pendingBudgetMs?: number;
  /** Indexer lag allowance past mined: op-stack 2s blocks + scan pass 5s. */
  indexedBudgetMs?: number;
  seq?: number;
  onStage?: (s: LifecycleSnapshot) => void;
  /** Supersede/unmount signal: once true the loop stops and the snapshot is
   *  frozen (reason 'aborted'); callers must ignore it by seq/gen. */
  shouldAbort?: () => boolean;
};

export const DEFAULT_PENDING_BUDGET_MS = 60_000;
export const DEFAULT_INDEXED_BUDGET_MS = 30_000;
export const DEFAULT_INTERVAL_MS = 2_000;

const realSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Drive one userOpHash through pending -> mined -> indexed (or terminal
 * failed naming the stuck stage). Pure and fully injectable — the golden
 * test scripts exact poll sequences, the hook wraps it with React state,
 * and the P-A runner calls it directly over HTTP against :8096.
 */
export async function runUserOpLifecycle(
  d: LifecycleDeps,
): Promise<LifecycleSnapshot> {
  const sleep = d.sleep ?? realSleep;
  const now = d.now ?? (() => Date.now());
  const interval = d.intervalMs ?? DEFAULT_INTERVAL_MS;
  let s: LifecycleSnapshot = {
    stage: 'pending',
    userOpHash: d.userOpHash,
    terminal: false,
    polls: 0,
    seq: d.seq ?? 0,
  };
  const emit = (next: LifecycleSnapshot) => {
    s = next;
    d.onStage?.(next);
  };
  const abort = () => {
    emit({ ...s, reason: 'aborted' });
    return s;
  };
  emit(s);

  // ── phase 1: pending at the RELAYER lane ───────────────────────────────
  const pendingDeadline = now() + (d.pendingBudgetMs ?? DEFAULT_PENDING_BUDGET_MS);
  for (;;) {
    if (d.shouldAbort?.()) return abort();
    let p: RelayerPoll;
    try {
      p = await d.pollTx(d.userOpHash);
    } catch {
      p = { relayer: 'pending' }; // transient — keep polling; budget decides
    }
    if (d.shouldAbort?.()) return abort();
    s = { ...s, polls: s.polls + 1 };
    if (p.relayer === 'failed') {
      emit({
        ...s,
        stage: 'failed',
        terminal: true,
        stuckAt: 'relayer',
        reason: `relayer reported failure: ${p.detail}`,
      });
      return s;
    }
    if (p.relayer === 'completed') {
      emit({ ...s, stage: 'mined', txHash: p.txHash });
      break;
    }
    if (now() >= pendingDeadline) {
      emit({
        ...s,
        stage: 'failed',
        terminal: true,
        stuckAt: 'relayer',
        reason: `eternal pending: relayer never mined within ${Math.round(
          (d.pendingBudgetMs ?? DEFAULT_PENDING_BUDGET_MS) / 1000,
        )}s (${s.polls} polls)`,
      });
      return s;
    }
    await sleep(interval);
  }

  // No indexer lane (ERC-20 approve, demo-contract tx): mined IS terminal.
  if (!d.probeIndex) {
    emit({
      ...s,
      terminal: true,
      indexedNa: true,
      reason: 'mined (this tx class has no indexer lane)',
    });
    return s;
  }

  // ── phase 2: mined -> indexed at the :8096 INDEXER lane ────────────────
  const indexedDeadline = now() + (d.indexedBudgetMs ?? DEFAULT_INDEXED_BUDGET_MS);
  for (;;) {
    if (d.shouldAbort?.()) return abort();
    let q: IndexProbe;
    try {
      q = await d.probeIndex(d.userOpHash, s.txHash);
    } catch {
      q = { index: 'pending' }; // transient — same discipline as phase 1
    }
    if (d.shouldAbort?.()) return abort();
    s = { ...s, polls: s.polls + 1 };
    if (q.index === 'success') {
      emit({
        ...s,
        stage: 'indexed',
        terminal: true,
        txHash: q.txHash ?? s.txHash,
        billAddress: q.billAddress,
      });
      return s;
    }
    if (q.index === 'no_event') {
      emit({
        ...s,
        terminal: true,
        indexedNa: true,
        reason: 'mined (no indexable event for this tx)',
      });
      return s;
    }
    if (q.index === 'failed') {
      emit({
        ...s,
        stage: 'failed',
        terminal: true,
        stuckAt: 'indexer',
        reason: `indexer rejected the mined tx: ${q.detail}`,
      });
      return s;
    }
    if (now() >= indexedDeadline) {
      emit({
        ...s,
        stage: 'failed',
        terminal: true,
        stuckAt: 'indexer',
        reason: `indexer lag past mined: not indexed within ${Math.round(
          (d.indexedBudgetMs ?? DEFAULT_INDEXED_BUDGET_MS) / 1000,
        )}s`,
      });
      return s;
    }
    await sleep(interval);
  }
}

/**
 * Normalize BOTH documented relayer shapes onto one vocabulary:
 *  - GET /api/v2/minikit/transaction/{id} (docs.worldcoin.org): nested
 *    `{ transaction: { status: 'pending'|'completed'|'failed',
 *    transaction_hash?, payload?: { txHash? } } }`
 *  - the flat shape the :8096 lane consumes (developer.world.org userop):
 *    `{ status: 'success'|'failed', transaction_hash }`
 * Anything unrecognized (HTML error pages, half-written JSON) degrades to
 * 'pending' — the budget is what converts silence into a defect, not a throw.
 */
export function normalizeRelayerPoll(body: unknown): RelayerPoll {
  if (typeof body !== 'object' || body === null) return { relayer: 'pending' };
  const b = body as Record<string, unknown>;
  const t =
    typeof b.transaction === 'object' && b.transaction !== null
      ? (b.transaction as Record<string, unknown>)
      : b;
  const status = String(t.status ?? b.status ?? '').toLowerCase();
  const payload =
    typeof t.payload === 'object' && t.payload !== null
      ? (t.payload as Record<string, unknown>)
      : undefined;
  const txHash =
    typeof t.transaction_hash === 'string'
      ? t.transaction_hash
      : typeof b.transaction_hash === 'string'
        ? b.transaction_hash
        : typeof payload?.txHash === 'string'
          ? payload.txHash
          : undefined;
  if (status === 'completed' || status === 'success') {
    return { relayer: 'completed', txHash };
  }
  if (status === 'failed') {
    return {
      relayer: 'failed',
      detail: String(
        t.error ?? t.message ?? b.error ?? b.instructions ?? 'relayer status=failed',
      ).slice(0, 160),
    };
  }
  return { relayer: 'pending' };
}

/**
 * Normalize the /api/bill-status/{h} proxy vocabulary (which mirrors the
 * :8096 bill_index row statuses: pending|success|failed|timeout|error|
 * no_event|absent). 'absent' (indexer unreachable / row not yet created) is
 * 'pending' to the loop — the indexed budget is what makes it a defect.
 */
export function normalizeIndexProbe(body: unknown): IndexProbe {
  if (typeof body !== 'object' || body === null) return { index: 'pending' };
  const b = body as Record<string, unknown>;
  const st = String(b.status ?? '').toLowerCase();
  if (st === 'success') {
    return {
      index: 'success',
      billAddress:
        typeof b.bill_address === 'string' ? b.bill_address : undefined,
      txHash: typeof b.tx_hash === 'string' ? b.tx_hash : undefined,
    };
  }
  if (st === 'no_event') return { index: 'no_event' };
  if (st === 'failed' || st === 'timeout' || st === 'error') {
    return {
      index: 'failed',
      detail: `status=${st}${
        typeof b.failed_at === 'string' ? ` at ${b.failed_at}` : ''
      }${typeof b.tx_hash === 'string' ? ` tx=${String(b.tx_hash).slice(0, 10)}…` : ''}`,
    };
  }
  // 'pending', 'absent', '' — keep polling within the indexed budget.
  return { index: 'pending' };
}

/** Human string for the UI: names the stuck stage + reason. Golden-tested. */
export function stuckMessage(s: LifecycleSnapshot): string {
  if (s.stage !== 'failed') return '';
  return `Stuck at ${s.stuckAt ?? 'unknown'}: ${s.reason ?? 'no reason recorded'}`;
}

/** Live caption for the UI while an op is in flight — the user always knows
 *  WHICH stage the pipeline is at, never an unexplained spinner. */
export function stageCaption(s: LifecycleSnapshot): string {
  switch (s.stage) {
    case 'idle':
      return '';
    case 'pending':
      return `waiting for World relayer to mine (pending, poll ${s.polls})…`;
    case 'mined':
      return s.indexedNa
        ? 'mined on-chain — this tx class has no indexer lane'
        : 'mined — waiting for indexer to land it…';
    case 'indexed':
      return 'mined + indexed — fully landed';
    case 'failed':
      return stuckMessage(s);
    default:
      return '';
  }
}
