'use client';

// W2.5-5 — React wrapper around the GOLDEN PATH in ./userOpStatus.ts.
// The hook owns no state-machine logic of its own: track() runs
// runUserOpLifecycle with fetch-backed pollers and pushes every emitted
// stage into React state. That is what makes "hook and runner share one
// golden path" true by construction, and why the lifecycle test can drive
// the identical machine headless.
//
// Endpoints (both same-origin proxies; no CORS surprises inside the
// World App webview):
//   GET /api/v2/minikit/transaction/{userOpHash}  -> relayer truth
//   GET /api/bill-status/{userOpHash}?tx=&bill=   -> :8096 indexer truth
// `indexStatusPath: null` opts the indexed stage out entirely (demo-tier
// txs with no indexer lane) — the lifecycle then terminates at mined.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INTERVAL_MS,
  IDLE_SNAPSHOT,
  normalizeIndexProbe,
  normalizeRelayerPoll,
  runUserOpLifecycle,
  type IndexProbe,
  type LifecycleSnapshot,
  type RelayerPoll,
} from './userOpStatus';

export type UseUserOpStatusOptions = {
  /** Path prefix for the relayer poll (contract endpoint path). */
  txStatusPath?: string;
  /** Path prefix for the indexer probe; null = no indexed lane. */
  indexStatusPath?: string | null;
  intervalMs?: number;
  pendingBudgetMs?: number;
  indexedBudgetMs?: number;
};

export type TrackContext = {
  /** Bill address for bill-scoped ops (confirm/initiate/execute/...): lets
   *  the oracle prove `indexed` from the settlement_events ledger instead of
   *  only the BillCreated lane. Omit for createBill (address arrives via
   *  the indexed snapshot itself). */
  bill?: string;
};

export type UserOpStatusApi = {
  snapshot: LifecycleSnapshot;
  /** Start (or restart) tracking a userOpHash through the golden path. */
  track: (userOpHash: string, ctx?: TrackContext) => void;
  /** Re-run the golden path for the last tracked hash (retry control). */
  retry: () => void;
  /** Stop tracking; snapshot returns to idle. */
  reset: () => void;
  stage: LifecycleSnapshot['stage'];
  terminal: boolean;
  isTracking: boolean;
};

const HEX64 = /^0x[0-9a-fA-F]{64}$/;

export function useUserOpStatus(opts: UseUserOpStatusOptions = {}): UserOpStatusApi {
  const {
    txStatusPath = '/api/v2/minikit/transaction',
    indexStatusPath = '/api/bill-status',
    intervalMs = DEFAULT_INTERVAL_MS,
    pendingBudgetMs,
    indexedBudgetMs,
  } = opts;

  const [snapshot, setSnapshot] = useState<LifecycleSnapshot>(IDLE_SNAPSHOT);
  // generation: bumped on every track()/unmount so stale lifecycle emits
  // from an abandoned op can never clobber the current snapshot.
  const genRef = useRef(0);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const lastRef = useRef<{ hash: string; ctx?: TrackContext } | null>(null);

  const pollTx = useCallback(
    async (hash: string): Promise<RelayerPoll> => {
      // Non-OK (404 propagating hash upstream, 502 proxy down) = "not yet
      // known" — keep polling; the pending budget converts eternal pending
      // into a named failure. This is the anti-dead-end invariant.
      let res: Response;
      try {
        res = await fetch(`${txStatusPath}/${hash}`, { cache: 'no-store' });
      } catch {
        return { relayer: 'pending' };
      }
      if (!res.ok) return { relayer: 'pending' };
      return normalizeRelayerPoll(await res.json().catch(() => null));
    },
    [txStatusPath],
  );

  const makeProbeIndex = useCallback(
    (ctx?: TrackContext) => {
      if (indexStatusPath === null) return undefined;
      return async (hash: string, txHash?: string): Promise<IndexProbe> => {
        const qs = new URLSearchParams();
        if (txHash) qs.set('tx', txHash);
        if (ctx?.bill) qs.set('bill', ctx.bill);
        const q = qs.toString();
        let res: Response;
        try {
          res = await fetch(
            `${indexStatusPath}/${hash}${q ? `?${q}` : ''}`,
            { cache: 'no-store' },
          );
        } catch {
          return { index: 'pending' };
        }
        if (!res.ok) return { index: 'pending' };
        return normalizeIndexProbe(await res.json().catch(() => null));
      };
    },
    [indexStatusPath],
  );

  const track = useCallback(
    (userOpHash: string, ctx?: TrackContext) => {
      if (!HEX64.test(userOpHash)) {
        setSnapshot({
          ...IDLE_SNAPSHOT,
          stage: 'failed',
          userOpHash,
          terminal: true,
          stuckAt: 'relayer',
          reason: 'invalid userOpHash (expected 0x + 64 hex)',
          seq: genRef.current + 1,
        });
        return;
      }
      const gen = ++genRef.current;
      abortRef.current = { aborted: false };
      lastRef.current = { hash: userOpHash, ctx };
      const seq = gen;
      void runUserOpLifecycle({
        userOpHash,
        seq,
        pollTx,
        probeIndex: makeProbeIndex(ctx),
        intervalMs,
        pendingBudgetMs,
        indexedBudgetMs,
        shouldAbort: () => abortRef.current.aborted || genRef.current !== gen,
        onStage: (s) => {
          if (genRef.current === gen) setSnapshot(s);
        },
      });
    },
    [pollTx, makeProbeIndex, intervalMs, pendingBudgetMs, indexedBudgetMs],
  );

  const retry = useCallback(() => {
    const last = lastRef.current;
    if (last) track(last.hash, last.ctx);
  }, [track]);

  const reset = useCallback(() => {
    genRef.current += 1;
    abortRef.current = { aborted: true };
    lastRef.current = null;
    setSnapshot(IDLE_SNAPSHOT);
  }, []);

  // Unmount: the in-flight loop must not setState into a dead component.
  useEffect(
    () => () => {
      genRef.current += 1;
      abortRef.current = { aborted: true };
    },
    [],
  );

  return {
    snapshot,
    track,
    retry,
    reset,
    stage: snapshot.stage,
    terminal: snapshot.terminal,
    isTracking: !snapshot.terminal && snapshot.stage !== 'idle',
  };
}
