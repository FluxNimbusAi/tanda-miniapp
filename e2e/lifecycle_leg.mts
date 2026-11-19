// W2.5-5 — P-A E2E leg. Asserts the SAME three states (pending -> mined ->
// indexed) that the golden unit test scripts, THROUGH THE SAME MACHINE the
// client hook wraps: this file imports src/lib/userOpStatus.ts directly
// (Node 26 native type-stripping — the exact module, no copy). If the
// machine drifts, the hook, useUserOpStatus.lifecycle.test.ts, and this leg
// fail together — one golden path by construction (OPP-003 Dead-end 1 fix;
// Flux-approved standalone).
//
// Modes:
//   --mock                       CI-safe. Loopback stubs for both lanes
//                                behind the app's proxy paths; asserts the
//                                exact stage sequence, relayer-fail -> retry
//                                recovery, and that failure strings NAME the
//                                stuck stage.
//   --live --hash 0x…            Real lanes: World relayer status endpoint +
//        [--tx 0x…] [--bill 0x…] :8096 /bills/by-userop/{h} (the upstream the
//        [--relayer-base URL]     app's bill-status oracle proxies).
//        [--index-base URL]
//
// Run:  node e2e/lifecycle_leg.mts --mock
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  normalizeIndexProbe,
  normalizeRelayerPoll,
  runUserOpLifecycle,
  stageCaption,
  stuckMessage,
  type IndexProbe,
  type LifecycleSnapshot,
  type RelayerPoll,
  type Stage,
} from '../src/lib/userOpStatus.ts';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const HASH = `0x${'ab'.repeat(32)}`;
const TX = `0x${'cd'.repeat(32)}`;
const BILL = `0x${'ef'.repeat(20)}`;

let failures = 0;
const assert = (cond: boolean, label: string): void => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
};

// ── fetch pollers with the SAME path shape the hook uses ───────────────────
function lanePollers(base: string, withIndex: boolean, bill?: string) {
  const pollTx = async (hash: string): Promise<RelayerPoll> => {
    const res = await fetch(`${base}/api/v2/minikit/transaction/${hash}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { relayer: 'pending' };
    return normalizeRelayerPoll(await res.json().catch(() => null));
  };
  const probeIndex = async (
    hash: string,
    txHash?: string,
  ): Promise<IndexProbe> => {
    const qs = new URLSearchParams();
    if (txHash) qs.set('tx', txHash);
    if (bill) qs.set('bill', bill);
    const q = qs.toString();
    const res = await fetch(
      `${base}/api/bill-status/${hash}${q ? `?${q}` : ''}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { index: 'pending' };
    return normalizeIndexProbe(await res.json().catch(() => null));
  };
  return { pollTx, probeIndex: withIndex ? probeIndex : undefined };
}

// ── mock: relayer pending->completed, indexer absent->success, toggleable
//    relayer failure to drive the retry scenario end-to-end ─────────────────
function startMock(): Promise<{
  base: string;
  setFailRelayer: (v: boolean) => void;
  reset: () => void;
  close: () => void;
}> {
  const state = { txN: 0, idxN: 0, failRelayer: false };
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const send = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.startsWith('/api/v2/minikit/transaction/')) {
      if (state.failRelayer) {
        return send({
          transaction: { status: 'failed', error: 'relayer dropped op (mock)' },
        });
      }
      state.txN += 1;
      return send(
        state.txN === 1
          ? { transaction: { status: 'pending' } }
          : { transaction: { status: 'completed', transaction_hash: TX } },
      );
    }
    if (url.startsWith('/api/bill-status/')) {
      state.idxN += 1;
      return send(
        state.idxN <= 1
          ? { status: 'absent' }
          : { status: 'success', bill_address: BILL, tx_hash: TX },
      );
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no route' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        setFailRelayer: (v) => {
          state.failRelayer = v;
        },
        reset: () => {
          state.txN = 0;
          state.idxN = 0;
        },
        close: () => server.close(),
      });
    });
  });
}

async function runMock(): Promise<void> {
  const mock = await startMock();
  try {
    // ── scenario 1: relayer fails -> TERMINAL FAILURE NAMING THE STAGE ────
    mock.setFailRelayer(true);
    const stages1: Stage[] = [];
    const s1 = await runUserOpLifecycle({
      userOpHash: HASH,
      ...lanePollers(mock.base, true),
      intervalMs: 20,
      onStage: (s) => stages1.push(s.stage),
    });
    assert(stages1.join(',') === 'pending,failed', `relayer-fail sequence ${stages1}`);
    assert(s1.stuckAt === 'relayer', 'failure names stuckAt=relayer');
    assert(
      stuckMessage(s1).startsWith('Stuck at relayer:'),
      `stuckMessage names the stage: ${stuckMessage(s1)}`,
    );

    // ── scenario 2: retry() of the SAME hash -> pending, mined, indexed ──
    // (Relayers are eventually consistent; retry re-runs the same golden
    // path — exactly what the hook's retry() control does.)
    mock.setFailRelayer(false);
    mock.reset();
    const stages2: Stage[] = [];
    const s2 = await runUserOpLifecycle({
      userOpHash: HASH,
      ...lanePollers(mock.base, true),
      intervalMs: 20,
      onStage: (s) => stages2.push(s.stage),
    });
    assert(
      stages2.join(',') === 'pending,mined,indexed',
      `GOLDEN three-state sequence after retry: ${stages2}`,
    );
    assert(s2.stage === 'indexed' && s2.terminal, 'terminal at indexed');
    assert(s2.txHash === TX && s2.billAddress === BILL, 'tx+bill landed from lanes');
    assert(
      stageCaption(s2).includes('mined + indexed'),
      `caption confirms full landing: ${stageCaption(s2)}`,
    );

    // ── scenario 3: no indexer lane (demo-class tx) -> honest mined ──────
    mock.reset();
    const s3 = await runUserOpLifecycle({
      userOpHash: HASH,
      ...lanePollers(mock.base, false),
      intervalMs: 20,
    });
    assert(s3.stage === 'mined' && s3.terminal === true, 'demo lane terminates at mined');
    assert(s3.indexedNa === true, 'indexedNa honest (no fake indexed tick)');
  } finally {
    mock.close();
  }
}

async function runLive(): Promise<void> {
  const hash = flag('hash');
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    console.error('--live requires --hash 0x<64 hex userOpHash>');
    process.exit(2);
  }
  const relayerBase =
    flag('relayer-base') ?? 'https://worldcoin.org/api/v2/minikit/transaction';
  const indexBase = (flag('index-base') ?? 'http://127.0.0.1:8096').replace(/\/+$/, '');
  const bill = flag('bill');
  const tx = flag('tx');
  const pendingBudget = flag('pending-budget')
    ? Number(flag('pending-budget'))
    : undefined;

  const stages: Stage[] = [];
  const snapshot: LifecycleSnapshot = await runUserOpLifecycle({
    userOpHash: hash,
    pendingBudgetMs: pendingBudget,
    pollTx: async (h) => {
      const res = await fetch(`${relayerBase}/${h}`, { cache: 'no-store' });
      return res.ok
        ? normalizeRelayerPoll(await res.json().catch(() => null))
        : { relayer: 'pending' };
    },
    probeIndex: async () => {
      // Lane A (tx+bill given): settlement_events membership — the SAME
      // lane the app's /api/bill-status oracle composes for bill-scoped
      // ops. Lane B: canonical /bills/by-userop/{h}. Both straight to the
      // real :8096 bill_index (upstream truth, zero mocks in this mode).
      if (bill && tx) {
        const res = await fetch(`${indexBase}/settlements/${bill}`, {
          cache: 'no-store',
        });
        if (!res.ok) return { index: 'pending' };
        const body = (await res.json().catch(() => null)) as {
          events?: { tx_hash?: string }[];
        } | null;
        const hit = (body?.events ?? []).some(
          (e) => String(e.tx_hash ?? '').toLowerCase() === tx.toLowerCase(),
        );
        return hit
          ? { index: 'success' as const, billAddress: bill, txHash: tx }
          : { index: 'pending' as const };
      }
      const res = await fetch(`${indexBase}/bills/by-userop/${hash}`, {
        cache: 'no-store',
      });
      return res.ok
        ? normalizeIndexProbe(await res.json().catch(() => null))
        : { index: 'pending' };
    },
    onStage: (s) => stages.push(s.stage),
  });
  console.log(JSON.stringify({ hash, stages, snapshot }, null, 1));
  assert(stages[0] === 'pending', 'lane starts at pending');
  // A hash the relayer never mined is EXPECTED real-world data (timeout
  // lanes). mined is only asserted when the relayer did complete; the
  // failed@relayer path is separately asserted as a NAMED defect below.
  if (snapshot.stage !== 'failed' || snapshot.stuckAt !== 'relayer') {
    assert(stages.includes('mined'), 'reached mined against real relayer');
  } else {
    console.log('  ok   (relayer never mined this hash -> named relayer-stage defect, see below)');
  }
  if (snapshot.stage === 'failed') {
    assert(Boolean(snapshot.stuckAt), 'failure NAMES the stuck stage');
    assert(/^Stuck at (relayer|indexer): /.test(stuckMessage(snapshot)), 'stuck message shape');
  } else {
    assert(stages.join(',') === 'pending,mined,indexed', 'three states against real :8096');
    assert(bill ? snapshot.stage === 'indexed' : true, 'indexed proof present');
  }
}

const started = Date.now();
if (has('live')) {
  console.log('P-A lifecycle e2e — LIVE mode');
  await runLive();
} else {
  console.log('P-A lifecycle e2e — MOCK mode (golden path shared with hook + unit test)');
  await runMock();
}
if (failures > 0) {
  console.error(`lifecycle_leg: ${failures} ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log(`lifecycle_leg: PASS (${Date.now() - started}ms)`);
