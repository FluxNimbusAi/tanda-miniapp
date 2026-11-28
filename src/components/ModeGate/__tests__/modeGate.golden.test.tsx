// @vitest-environment jsdom
// W2.5-3 (t_14b21fee) MODE-SWITCH GOLDEN. The contract:
//   isInstalled === true  -> full app hero ONLY (AuthButton wall allowed here,
//                            Explorer must not render).
//   isInstalled false (definite browser)      -> Read-Only Live Explorer
//                            ONLY, ZERO wallet affordances, GET-only surface.
//   APP-1 LAW CHANGE (t_f16cf60b): isInstalled null/undefined (pre-init on
//                            client) -> SPLASH, not explorer: World App users
//                            were FLASHED the browser explorer for a beat on
//                            every cold open. Splash is the native entry cue;
//                            definite-false still routes straight to Explorer.
//   flip true->false       -> Explorer renders (route-level reactive gate).
//   KAIZEN-8 ladder        -> degraded reads surface LAST-KNOWN-GOOD (server
//                            cache replay or browser snapshot) as
//                            indexer: cached + as-of chip; only a true cold
//                            miss shows indexer: offline.
// Data lane pins the PR #22 settlements + SR-003 bill-lifecycle readback with
// the W10 first-real-bill payload (bill be4326..., execute tx ae4a5890...):
// all four lifecycle events + derived status 'executed' + 0.020000 USDC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({
  isInstalled: undefined as boolean | undefined,
  fetchCalls: [] as { url: string; method: string }[],
  liveFails: false,
  liveBody: null as Record<string, unknown> | null,
}));

vi.mock('@worldcoin/minikit-js/minikit-provider', () => ({
  useMiniKit: () => ({ isInstalled: H.isInstalled }),
}));

vi.mock('@/components/AuthButton', () => ({
  AuthButton: () => <button>Login with Wallet</button>,
}));

vi.mock('@/components/PageLayout', () => {
  const Box = ({ children }: { children?: ReactNode; className?: string }) => (
    <div>{children}</div>
  );
  const P = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  (P as unknown as Record<string, unknown>).Main = Box;
  (P as unknown as Record<string, unknown>).Header = Box;
  (P as unknown as Record<string, unknown>).Footer = Box;
  return { Page: P };
});

const BILL = '0xbe4326dec14d41383dd195097b125905b209846c';
const TX_EXEC = '0xae4a589017dca988f299c7dfffbdcf8c64ab3363131c7f3b22e3f911b80fac8a';

const LIVE_STATUS = {
  status: 'ok',
  service: 'bill_index',
  chain_id: 4801,
  uptime_s: 100,
  db: 'ok',
  bills_indexed: 18,
  bills_resolved: 2,
  seat_grants: 13,
  verifications: 20,
  settlements: 1,
};
const SETTLE_FEED = {
  bill: BILL,
  page: 1,
  page_size: 20,
  total_settlements: 1,
  total_events: 4,
  settlements: [
    {
      bill_id: BILL,
      settlement_id: 0,
      user_op_hash: null,
      tx_hash: TX_EXEC,
      block: 37279405,
      total_amount: 20000,
      settled_at: 1795106234,
      confirmed_at: '2026-11-19T19:27:09Z',
      initiated_block: 37277221,
      fully_confirmed_at: 1795101868,
      refunded: 0,
      claimed_count: 0,
      claimed_amount: 0,
    },
  ],
  events: [
    { settlement_id: 0, event: 'SettlementInitiated', tx_hash: '0x5fd7', log_index: 0, block: 37277221, seat_id: null, wallet: null, amount: 20000 },
    { settlement_id: 0, event: 'SeatConfirmed', tx_hash: '0x6126', log_index: 0, block: 37277222, seat_id: 0, wallet: null, amount: null },
    { settlement_id: 0, event: 'SettlementFullyConfirmed', tx_hash: '0x6126', log_index: 1, block: 37277222, seat_id: null, wallet: null, amount: null },
    { settlement_id: 0, event: 'SettlementExecuted', tx_hash: TX_EXEC, log_index: 1, block: 37279405, seat_id: null, wallet: null, amount: 20000 },
  ],
};
const GRANTS = { grants: { '0xw1': { verified_at: 1 }, '0xw2': { verified_at: 2 } } };

const jsonResponse = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

// Chip = <span>label: <strong>value</strong></span>. RTL's default matcher
// only sees direct child text, so query the span by its FULL textContent.
const chip = (re: RegExp) =>
  screen.getByText((_content, el) => el?.tagName === 'SPAN' && re.test(el.textContent ?? ''));

beforeEach(() => {
  H.fetchCalls.length = 0;
  H.liveFails = false;
  H.liveBody = null;
  window.localStorage.clear(); // KAIZEN-8: snapshots never bleed across goldens
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method ?? (input as Request).method ?? 'GET').toUpperCase();
      H.fetchCalls.push({ url, method });
      if (url.includes('/api/live-status')) {
        if (H.liveFails) throw new TypeError('fetch failed');
        if (H.liveBody) return jsonResponse(H.liveBody);
        return jsonResponse({ ...LIVE_STATUS, indexed: true });
      }
      if (url.includes('/api/settlements')) return jsonResponse(SETTLE_FEED);
      if (url.includes('/api/seat-grants')) return jsonResponse(GRANTS);
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function gate() {
  const { ModeGate } = await import('@/components/ModeGate');
  return ModeGate;
}

describe('W2.5-3 dual-mode gate', () => {
  it('World App lane: isInstalled=true renders the full hero, no Explorer', async () => {
    H.isInstalled = true;
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText('Login with Wallet')).toBeInTheDocument();
    expect(screen.queryByText(/Watch it happen/)).toBeNull();
  });

  it('browser lane: isInstalled=false renders the Explorer, zero wallet affordances', async () => {
    H.isInstalled = false;
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    expect(screen.queryByText('Login with Wallet')).toBeNull();
    expect(screen.queryByText('Verify with World ID')).toBeNull();
    await waitFor(() => expect(chip(/indexer: live/)).toBeInTheDocument());
    expect(chip(/bills indexed: 18/)).toBeInTheDocument();
  });

  // APP-1 LAW CHANGE (t_f16cf60b): pre-init now shows the branded SPLASH —
  // the old contract (undefined -> Explorer) is what flashed browser chrome at
  // World App users on cold open. Definite-browser (false) keeps the Explorer
  // lane unchanged; splash shows NEITHER explorer nor wallet affordances.
  it('pre-init (isInstalled undefined) shows the splash, not an explorer flash', async () => {
    H.isInstalled = undefined;
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByTestId('app-splash-kicker')).toBeInTheDocument();
    expect(screen.queryByText(/Watch it happen/)).toBeNull();
    expect(screen.queryByText('Login with Wallet')).toBeNull();
  });

  it('route-level flip true->false re-renders the gate into the Explorer', async () => {
    H.isInstalled = true;
    const ModeGate = await gate();
    const { rerender } = render(<ModeGate />);
    expect(await screen.findByText('Login with Wallet')).toBeInTheDocument();
    H.isInstalled = false;
    rerender(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    expect(screen.queryByText('Login with Wallet')).toBeNull();
  });

  it('indexer offline degrades the Explorer, never an error state', async () => {
    H.isInstalled = false;
    H.liveFails = true;
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    await waitFor(() => expect(chip(/indexer: offline/)).toBeInTheDocument());
  });

  it('warm server cache renders last-known-good chips + as-of, not offline', async () => {
    H.isInstalled = false;
    H.liveBody = {
      ...LIVE_STATUS,
      indexed: false,
      source: 'cache',
      stale: true,
      as_of: 1764290000,
      note: 'indexer unreachable; showing last-known-good',
    };
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    await waitFor(() => expect(chip(/indexer: cached/)).toBeInTheDocument());
    expect(chip(/bills indexed: 18/)).toBeInTheDocument();
    expect(chip(/as of: /)).toBeInTheDocument();
  });

  it('cold server + browser snapshot still degrades to cached, never offline', async () => {
    H.isInstalled = false;
    H.liveFails = true;
    window.localStorage.setItem(
      'tanda.explorer.live-snapshot.v1',
      JSON.stringify({
        body: { ...LIVE_STATUS, indexed: true },
        savedAt: Math.floor(Date.now() / 1000) - 600,
      }),
    );
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    await waitFor(() => expect(chip(/indexer: cached/)).toBeInTheDocument());
    expect(chip(/settlements: 1/)).toBeInTheDocument();
  });

  it('expired browser snapshot (>24h) honestly reads offline, not cached', async () => {
    H.isInstalled = false;
    H.liveFails = true;
    window.localStorage.setItem(
      'tanda.explorer.live-snapshot.v1',
      JSON.stringify({
        body: { ...LIVE_STATUS, indexed: true },
        savedAt: Math.floor(Date.now() / 1000) - 25 * 3600,
      }),
    );
    const ModeGate = await gate();
    render(<ModeGate />);
    expect(await screen.findByText(/Watch it happen/)).toBeInTheDocument();
    await waitFor(() => expect(chip(/indexer: offline/)).toBeInTheDocument());
  });

  it('malformed bill is rejected client-side before any lookup fetch', async () => {
    H.isInstalled = false;
    const ModeGate = await gate();
    render(<ModeGate />);
    await screen.findByText(/Watch it happen/);
    fireEvent.change(screen.getByLabelText('Bill address'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: /look up bill/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('40 hex');
    expect(
      H.fetchCalls.filter(
        (c) => c.url.includes('/api/settlements') || c.url.includes('/api/seat-grants'),
      ),
    ).toHaveLength(0);
  });

  it('PR #22 + lifecycle readback: W10 bill renders the full ledger, GET-only', async () => {
    H.isInstalled = false;
    const ModeGate = await gate();
    render(<ModeGate />);
    await screen.findByText(/Watch it happen/);
    fireEvent.change(screen.getByLabelText('Bill address'), {
      target: { value: BILL.toUpperCase() },
    });
    fireEvent.click(screen.getByRole('button', { name: /look up bill/i }));

    expect(await screen.findByText('SettlementInitiated')).toBeInTheDocument();
    expect(screen.getByText('SeatConfirmed')).toBeInTheDocument();
    expect(screen.getByText('SettlementFullyConfirmed')).toBeInTheDocument();
    expect(screen.getByText('SettlementExecuted')).toBeInTheDocument();
    expect(screen.getByText('executed')).toBeInTheDocument();
    expect(screen.getAllByText(/0\.02 USDC/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/2 verified seat\(s\)/)).toBeInTheDocument();
    // Bill is lowercased before hitting the read routes.
    expect(
      H.fetchCalls.find((c) => c.url.includes('/api/settlements'))?.url,
    ).toContain(BILL);
    // READ-ONLY INVARIANT: every request this component makes is a GET.
    expect(H.fetchCalls.every((c) => c.method === 'GET')).toBe(true);
    expect(H.fetchCalls.some((c) => c.method === 'POST')).toBe(false);
  });
});
