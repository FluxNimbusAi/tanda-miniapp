// @vitest-environment jsdom
// W2.5-5 GOLDEN (OPP-003 fc26d6cc27f6…): exact poll sequences through the
// ONE lifecycle machine. The same src/lib/userOpStatus.ts module is wrapped
// by the client hook AND imported by the P-A runner (e2e/lifecycle_leg.mts),
// so these sequences pin the shared golden path for both lanes.
//
// Pinned behaviors:
//   pending -> mined -> indexed          (exact stage order, terminal)
//   relayer-fail -> retry of same hash   (eventual-consistency recovery)
//   eternal pending                      (budget -> terminal failed, stuckAt
//                                         relayer — the defect, never a spinner)
//   indexer stall past mined             (budget -> terminal failed, stuckAt
//                                         indexer)
//   approve-class no_event / no lane     (terminal mined + indexedNa — HONEST)
//   transient throw                      (loop keeps polling; budget decides)
//   both documented relayer body shapes  (nested + flat)
//   hook over stubbed fetch              (integration incl. retry() control)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, act, renderHook, waitFor } from '@testing-library/react';
import {
  IDLE_SNAPSHOT,
  normalizeIndexProbe,
  normalizeRelayerPoll,
  runUserOpLifecycle,
  stageCaption,
  stuckMessage,
  type IndexProbe,
  type LifecycleSnapshot,
  type RelayerPoll,
  type Stage,
} from '@/lib/userOpStatus';
import { useUserOpStatus } from '@/lib/useUserOpStatus';

const HASH = `0x${'ab'.repeat(32)}`;
const TX = `0x${'cd'.repeat(32)}`;
const BILL = `0x${'ef'.repeat(20)}`;

/** Deterministic clock: every sleep advances time by stepMs, so budgets
 *  expire without real timers. */
function fakeClock(stepMs: number) {
  let t = 0;
  return {
    now: () => t,
    sleep: async () => {
      t += stepMs;
    },
  };
}

function seqPolls(list: RelayerPoll[]): () => Promise<RelayerPoll> {
  let i = 0;
  return async () => list[Math.min(i++, list.length - 1)];
}
function seqProbes(list: IndexProbe[]): (h: string, tx?: string) => Promise<IndexProbe> {
  let i = 0;
  return async () => list[Math.min(i++, list.length - 1)];
}

async function drive(
  relayer: RelayerPoll[],
  index: IndexProbe[] | 'none',
  extra: Partial<Parameters<typeof runUserOpLifecycle>[0]> = {},
) {
  const clock = fakeClock(10_000);
  const stages: Stage[] = [];
  const snapshot = await runUserOpLifecycle({
    userOpHash: HASH,
    pollTx: seqPolls(relayer),
    probeIndex: index === 'none' ? undefined : seqProbes(index),
    sleep: clock.sleep,
    now: clock.now,
    intervalMs: 2_000,
    // STAGE-TRANSITION sequence, deduped: the machine re-emits `mined` with
    // terminal metadata (indexedNa/terminal/reason) for the no-event lane —
    // the UI must see that emit, but it is not a new stage.
    onStage: (s) => {
      if (stages[stages.length - 1] !== s.stage) stages.push(s.stage);
    },
    ...extra,
  });
  return { snapshot, stages };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useUserOpStatus lifecycle GOLDEN — exact sequences on the shared machine', () => {
  it('happy path emits EXACTLY pending -> mined -> indexed', async () => {
    const { snapshot, stages } = await drive(
      [{ relayer: 'pending' }, { relayer: 'completed', txHash: TX }],
      [{ index: 'pending' }, { index: 'success', billAddress: BILL, txHash: TX }],
    );
    expect(stages).toEqual(['pending', 'mined', 'indexed']);
    expect(snapshot.stage).toBe('indexed');
    expect(snapshot.terminal).toBe(true);
    expect(snapshot.txHash).toBe(TX);
    expect(snapshot.billAddress).toBe(BILL);
    expect(snapshot.polls).toBe(4); // 2 relayer + 2 indexer
    expect(snapshot.seq).toBe(0); // pure machine keeps caller-supplied seq
  });

  it('relayer-fail is TERMINAL and names RELAYER; retry of the same hash reaches INDEXED', async () => {
    const fail = await drive(
      [{ relayer: 'failed', detail: 'relayer dropped op' }],
      [],
    );
    expect(fail.stages).toEqual(['pending', 'failed']);
    expect(fail.snapshot.stuckAt).toBe('relayer');
    expect(fail.snapshot.reason).toContain('relayer dropped op');
    expect(stuckMessage(fail.snapshot)).toMatch(/^Stuck at relayer: /);
    // retry() semantics (hook control): re-run the SAME golden path against
    // the SAME immutable userOpHash — relayers are eventually-consistent.
    const retry = await drive(
      [{ relayer: 'pending' }, { relayer: 'completed', txHash: TX }],
      [{ index: 'success', billAddress: BILL, txHash: TX }],
    );
    expect(retry.stages).toEqual(['pending', 'mined', 'indexed']);
  });

  it('eternal pending is a DEFECT: pending budget -> failed naming RELAYER', async () => {
    const { snapshot, stages } = await drive([{ relayer: 'pending' }], []);
    expect(snapshot.stage).toBe('failed');
    expect(snapshot.terminal).toBe(true);
    expect(snapshot.stuckAt).toBe('relayer');
    expect(snapshot.reason).toContain('eternal pending');
    expect(snapshot.polls).toBeGreaterThanOrEqual(6); // 60s / 10s fake steps
    expect(stuckMessage(snapshot)).toMatch(/^Stuck at relayer: eternal pending/);
    expect(stages[stages.length - 1]).toBe('failed');
  });

  it('indexer stall past mined -> failed naming INDEXER (never a silent mined)', async () => {
    const { snapshot } = await drive(
      [{ relayer: 'completed', txHash: TX }],
      [{ index: 'pending' }],
      { indexedBudgetMs: 30_000 },
    );
    expect(snapshot.stage).toBe('failed');
    expect(snapshot.stuckAt).toBe('indexer');
    expect(snapshot.reason).toContain('indexer lag past mined');
    expect(stuckMessage(snapshot)).toMatch(/^Stuck at indexer: /);
  });

  it('indexer REJECTS a mined tx -> failed naming INDEXER with the detail', async () => {
    const { snapshot } = await drive(
      [{ relayer: 'completed', txHash: TX }],
      [{ index: 'failed', detail: 'decode mismatch' }],
    );
    expect(snapshot.stuckAt).toBe('indexer');
    expect(snapshot.reason).toContain('decode mismatch');
  });

  it('approve-class no_event terminates HONESTLY at mined (indexedNa)', async () => {
    const { snapshot, stages } = await drive(
      [{ relayer: 'completed', txHash: TX }],
      [{ index: 'no_event' }],
    );
    expect(stages).toEqual(['pending', 'mined']);
    expect(snapshot.terminal).toBe(true);
    expect(snapshot.indexedNa).toBe(true);
    expect(snapshot.stage).toBe('mined');
    expect(stageCaption(snapshot)).toContain('no indexer lane');
  });

  it('no indexer lane at all (probeIndex omitted) = terminal mined + indexedNa', async () => {
    const { snapshot, stages } = await drive(
      [{ relayer: 'completed', txHash: TX }],
      'none',
    );
    expect(stages).toEqual(['pending', 'mined']);
    expect(snapshot.indexedNa).toBe(true);
    expect(snapshot.reason).toContain('no indexer lane');
  });

  it('transient throws do NOT kill the run — the budget decides, not noise', async () => {
    let n = 0;
    const flaky = async (): Promise<RelayerPoll> => {
      if (++n === 1) throw new Error('ECONNRESET');
      return { relayer: 'completed', txHash: TX };
    };
    const clock = fakeClock(1_000);
    const snapshot = await runUserOpLifecycle({
      userOpHash: HASH,
      pollTx: flaky,
      probeIndex: async () => ({ index: 'success', billAddress: BILL }),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(snapshot.stage).toBe('indexed');
  });

  it('supersede/abort freezes the loop — a stale op never clobbers state', async () => {
    let abort = false;
    const p = runUserOpLifecycle({
      userOpHash: HASH,
      pollTx: seqPolls([{ relayer: 'pending' }]),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      intervalMs: 5,
      shouldAbort: () => abort,
    });
    setTimeout(() => {
      abort = true;
    }, 15);
    const snap = await p;
    expect(snap.stage).toBe('pending'); // frozen, NOT terminal-failed
    expect(snap.terminal).toBe(false);
    expect(snap.reason).toBe('aborted');
  });
});

describe('relayer + index body normalization — documented shapes only', () => {
  it('normalizeRelayerPoll covers BOTH official shapes and degrades noise to pending', () => {
    expect(normalizeRelayerPoll({ transaction: { status: 'pending' } })).toEqual({
      relayer: 'pending',
    });
    expect(
      normalizeRelayerPoll({
        transaction: { status: 'completed', transaction_hash: TX },
      }),
    ).toEqual({ relayer: 'completed', txHash: TX });
    // flat :8096/userop vocabulary
    expect(normalizeRelayerPoll({ status: 'success', transaction_hash: TX })).toEqual({
      relayer: 'completed',
      txHash: TX,
    });
    // payload.txHash fallback lane
    expect(
      normalizeRelayerPoll({ transaction: { status: 'completed', payload: { txHash: TX } } }),
    ).toEqual({ relayer: 'completed', txHash: TX });
    const f = normalizeRelayerPoll({
      transaction: { status: 'failed', error: 'insufficient funds' },
    });
    expect(f).toEqual({ relayer: 'failed', detail: 'insufficient funds' });
    // garbage never throws — the BUDGET converts silence into a defect
    expect(normalizeRelayerPoll('<html>502 Bad Gateway</html>')).toEqual({
      relayer: 'pending',
    });
    expect(normalizeRelayerPoll(null)).toEqual({ relayer: 'pending' });
  });

  it('normalizeIndexProbe maps the oracle vocabulary (absent=pending, timeout=failed)', () => {
    expect(normalizeIndexProbe({ status: 'absent' })).toEqual({ index: 'pending' });
    expect(normalizeIndexProbe({ status: 'pending' })).toEqual({ index: 'pending' });
    expect(
      normalizeIndexProbe({ status: 'success', bill_address: BILL, tx_hash: TX }),
    ).toEqual({ index: 'success', billAddress: BILL, txHash: TX });
    expect(normalizeIndexProbe({ status: 'no_event' })).toEqual({ index: 'no_event' });
    const bad = normalizeIndexProbe({ status: 'timeout', failed_at: 'scan' });
    expect(bad.index).toBe('failed');
    if (bad.index === 'failed') expect(bad.detail).toContain('status=timeout');
    expect(normalizeIndexProbe(null)).toEqual({ index: 'pending' });
  });

  it('UI strings name the exact stage for every in-flight state', () => {
    expect(stageCaption(IDLE_SNAPSHOT)).toBe('');
    const pend: LifecycleSnapshot = {
      ...IDLE_SNAPSHOT,
      stage: 'pending',
      userOpHash: HASH,
      polls: 3,
    };
    expect(stageCaption(pend)).toBe(
      'waiting for World relayer to mine (pending, poll 3)…',
    );
    const mined: LifecycleSnapshot = { ...pend, stage: 'mined', polls: 4 };
    expect(stageCaption(mined)).toBe('mined — waiting for indexer to land it…');
    const landed: LifecycleSnapshot = { ...mined, stage: 'indexed', terminal: true };
    expect(stageCaption(landed)).toBe('mined + indexed — fully landed');
    const failed: LifecycleSnapshot = {
      ...pend,
      stage: 'failed',
      terminal: true,
      stuckAt: 'indexer',
      reason: 'indexer lag past mined',
    };
    expect(stuckMessage(failed)).toBe('Stuck at indexer: indexer lag past mined');
  });
});

// ── hook integration: proves the client wrapper drives THIS machine over
//    fetch with the contract paths (no logic of its own to drift) ───────────
describe('useUserOpStatus hook — fetch integration on the shared machine', () => {
  const urls: string[] = [];
  function stubFetch(handler: (u: string) => unknown) {
    urls.length = 0;
    vi.stubGlobal(
      'fetch',
      async (input: unknown) => {
        const u = String(input);
        urls.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => handler(u),
        } as unknown as Response;
      },
    );
  }

  it('track() walks pending -> mined -> indexed against the proxy paths', async () => {
    let txN = 0;
    let idxN = 0;
    stubFetch((u) => {
      if (u.startsWith('/api/v2/minikit/transaction/')) {
        txN += 1;
        return txN === 1
          ? { transaction: { status: 'pending' } }
          : { transaction: { status: 'completed', transaction_hash: TX } };
      }
      idxN += 1;
      return idxN === 1
        ? { status: 'absent' }
        : { status: 'success', bill_address: BILL, tx_hash: TX };
    });
    const { result } = renderHook(() => useUserOpStatus({ intervalMs: 5 }));
    result.current.track(HASH, { bill: BILL });
    await waitFor(() => expect(result.current.snapshot.stage).toBe('indexed'), {
      timeout: 5000,
    });
    expect(result.current.snapshot.txHash).toBe(TX);
    expect(result.current.snapshot.billAddress).toBe(BILL);
    expect(result.current.terminal).toBe(true);
    expect(result.current.isTracking).toBe(false);
    // bill-scoped context reaches the oracle query string (settlements lane)
    expect(urls.some((u) => u.startsWith('/api/bill-status/') && u.includes(`bill=${BILL}`))).toBe(
      true,
    );
  });

  it('relayer failure surfaces the NAMED stage; retry() control recovers to indexed', async () => {
    let failRelayer = true;
    stubFetch((u) => {
      if (u.startsWith('/api/v2/minikit/transaction/')) {
        return failRelayer
          ? { transaction: { status: 'failed', error: 'relayer dropped op' } }
          : { transaction: { status: 'completed', transaction_hash: TX } };
      }
      return { status: 'success', bill_address: BILL, tx_hash: TX };
    });
    const { result } = renderHook(() => useUserOpStatus({ intervalMs: 5 }));
    result.current.track(HASH);
    await waitFor(() => expect(result.current.snapshot.stage).toBe('failed'), {
      timeout: 5000,
    });
    expect(result.current.snapshot.stuckAt).toBe('relayer');
    expect(stuckMessage(result.current.snapshot)).toContain('Stuck at relayer:');
    failRelayer = false;
    result.current.retry();
    await waitFor(() => expect(result.current.snapshot.stage).toBe('indexed'), {
      timeout: 5000,
    });
    expect(result.current.snapshot.seq).toBeGreaterThan(1); // fresh op instance
  });

  it('a malformed hash is an instant NAMED defect, not a poll storm', () => {
    // tripwire: ANY fetch here is a bug — urls starts clean and stays empty.
    stubFetch(() => {
      throw new Error('client-side reject must never reach the network');
    });
    const { result } = renderHook(() => useUserOpStatus({ intervalMs: 5 }));
    // track() rejects client-side SYNCHRONOUSLY (zero network) — act() so
    // the immediate setState flushes before the assertion.
    act(() => result.current.track('0xnope'));
    expect(result.current.snapshot.stage).toBe('failed');
    expect(result.current.snapshot.terminal).toBe(true);
    expect(result.current.snapshot.stuckAt).toBe('relayer');
    expect(result.current.snapshot.reason).toContain('invalid userOpHash');
    expect(urls).toHaveLength(0); // zero network for a client-side reject
  });

  it('indexStatusPath null (demo class) terminates at mined with indexedNa', async () => {
    stubFetch(() => ({ transaction: { status: 'completed', transaction_hash: TX } }));
    const { result } = renderHook(() =>
      useUserOpStatus({ intervalMs: 5, indexStatusPath: null }),
    );
    result.current.track(HASH);
    await waitFor(() => expect(result.current.snapshot.terminal).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.snapshot.stage).toBe('mined');
    expect(result.current.snapshot.indexedNa).toBe(true);
    expect(urls.every((u) => !u.startsWith('/api/bill-status/'))).toBe(true);
  });
});
