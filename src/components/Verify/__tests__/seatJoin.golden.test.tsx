// @vitest-environment jsdom
// W2-F1 golden (t_92a43849): pins the REAL JOIN wire contract Harley's P0
// found missing — preset must be proofOfHuman bound to `${bill}:${wallet}`
// (both lowercase) and the verify-proof POST body must carry bill+wallet next
// to { rp_id, idkitResponse }. Demo path regression: unchanged orbLegacy with
// empty signal and the two-field body. IDKit and the ui-kit are pass-through
// mocks; the payload shape is the subject under test.
//
// W2-F1c fold (PR #18 rebase, t_1d3f2f38): the 7 byte-exact wire-pin asserts
// from seat-join.golden.test.tsx (issue #15) are folded into this file —
// raw JSON.stringify strings compared with toBe (the test IS the contract),
// captured by the hoisted H.rpSigBodies/vpBodies machinery. Helpers from the
// fold carry the Join* prefix to avoid redeclaring stubFetch/clickVerify.
// The seat lane pins rp-signature body {"action":"bill:confirm"}: the frozen
// allowlist member in src/lib/rpSignatureGuard.ts (PR #14) — NEVER the
// caller-supplied action. Demo lane stays template-identical.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => {
  const FAKE_PROOF = {
    protocol_version: '4',
    nonce: 'nonce-abc',
    action: 'seat-join',
    responses: [{ nullifier: 'nullifier_xyz', signal_hash: '0xdead' }],
  };
  return {
    FAKE_PROOF,
    presetCalls: [] as unknown[],
    // W2-F1c fold: raw (byte) capture of the two POST bodies + IDKit cfgs.
    rpSigBodies: [] as string[],
    vpBodies: [] as string[],
    requestCfgs: [] as Record<string, unknown>[],
    completion: { success: true, result: FAKE_PROOF } as Record<string, unknown>,
    rpStatus: 200,
    rpJson: {
      rp_id: 'rp_test_1',
      sig: 's',
      nonce: 'n-1',
      created_at: 1,
      expires_at: 2,
    } as Record<string, unknown>,
    vpJson: { success: true, granted: true } as Record<string, unknown>,
  };
});

const { presetCalls, FAKE_PROOF } = H;

vi.mock('@worldcoin/idkit', () => ({
  IDKit: {
    // IDKit 4.1.2 calls request(...) synchronously and chains .preset() on
    // the returned builder (dist/index.js:326) — the mock must mirror that.
    request: vi.fn((cfg: Record<string, unknown>) => {
      H.requestCfgs.push(cfg);
      return {
        preset: (p: unknown) => {
          H.presetCalls.push(p);
          return { pollUntilCompletion: async () => H.completion };
        },
      };
    }),
  },
  orbLegacy: vi.fn((o: { signal?: string }) => ({ type: 'OrbLegacy', ...o })),
  proofOfHuman: vi.fn((o: { signal?: string }) => ({ type: 'ProofOfHuman', ...o })),
}));

vi.mock('@worldcoin/mini-apps-ui-kit-react', () => ({
  Button: ({
    onClick,
    children,
  }: {
    onClick?: () => void;
    children?: ReactNode;
  }) => <button onClick={onClick}>{children}</button>,
  LiveFeedback: ({
    label,
    state,
    children,
  }: {
    label: Record<string, string>;
    state?: string;
    children?: ReactNode;
  }) => (
    <div data-testid="live-feedback" data-state={state ?? 'idle'}>
      {children}
      {state ? <span data-testid="feedback-label">{label[state]}</span> : null}
    </div>
  ),
}));

import { Verify } from '@/components/Verify';

const BILL_MIXED = '0xAaBbCcDDEEFF00112233445566778899AABBCCD0';
const BILL = BILL_MIXED.toLowerCase();
const WALLET = '0x1111111111111111111111111111111111111111';
const RP_SIG = { rp_id: 'rp_test_1', sig: 's', nonce: 'n-1', created_at: 1, expires_at: 2 };

type FetchCall = { url: string; body: unknown };

function stubFetch(verifyProofResponse: unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const payload =
        url === '/api/rp-signature' ? RP_SIG : verifyProofResponse;
      return { ok: true, json: async () => payload } as Response;
    }),
  );
  return calls;
}

const clickVerify = () =>
  fireEvent.click(screen.getByRole('button', { name: /verify with world id/i }));

// --- W2-F1c fold: byte-exact lane (raw strings, never parsed) --------------
// golden literals are hand-written: the test IS the contract.
const BILL_IN = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
const BILL_L = '0xabcdef1234567890abcdef1234567890abcdef12';
const WALLET_IN = '0xFEEDBEEF0123456789feadb0000000000000beef';
const WALLET_L = '0xfeedbeef0123456789feadb0000000000000beef';

const GOLDEN_RP_BODY = '{"action":"bill:confirm"}';
const GOLDEN_SIGNAL = `${BILL_L}:${WALLET_L}`;
// Serialized completion.result (FAKE_PROOF) — key order is part of the pin.
const GOLDEN_IDKIT_RESULT =
  '{"protocol_version":"4","nonce":"nonce-abc","action":"seat-join","responses":[{"nullifier":"nullifier_xyz","signal_hash":"0xdead"}]}';
// F1b wire contract: rp_id, idkitResponse, bill, wallet — in exactly this order.
const GOLDEN_VP_BODY =
  '{"rp_id":"rp_test_1","idkitResponse":' +
  GOLDEN_IDKIT_RESULT +
  ',"bill":"' +
  BILL_L +
  '","wallet":"' +
  WALLET_L +
  '"}';
// Demo lane keeps the template byte shape: rp_id + idkitResponse ONLY.
const GOLDEN_DEMO_RP_BODY = '{"action":"test-action"}';
const GOLDEN_DEMO_VP_BODY =
  '{"rp_id":"rp_test_1","idkitResponse":' + GOLDEN_IDKIT_RESULT + '}';

function JoinStubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/rp-signature') {
        H.rpSigBodies.push(String(init?.body));
        return { ok: H.rpStatus === 200, status: H.rpStatus, json: async () => H.rpJson } as Response;
      }
      if (url === '/api/verify-proof') {
        H.vpBodies.push(String(init?.body));
        return { ok: true, status: 200, json: async () => H.vpJson } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

const JoinClickVerify = () =>
  fireEvent.click(screen.getByRole('button', { name: /verify with world id/i }));

afterEach(() => {
  cleanup();
  presetCalls.length = 0;
  H.rpSigBodies.length = 0;
  H.vpBodies.length = 0;
  H.requestCfgs.length = 0;
  H.completion = { success: true, result: FAKE_PROOF };
  H.rpStatus = 200;
  H.rpJson = { ...RP_SIG };
  H.vpJson = { success: true, granted: true };
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Verify — W2-F1 seat join golden', () => {
  it('proofOfHuman bound to bill:wallet AND verify-proof carries bill+wallet legs', async () => {
    const calls = stubFetch({ success: true, granted: true });
    const onVerified = vi.fn();
    render(
      <Verify
        action="seat-join"
        seat={{ bill: BILL_MIXED, wallet: WALLET }}
        onVerified={onVerified}
      />,
    );
    clickVerify();
    await waitFor(() => expect(calls.length).toBe(2));

    // Leg 1: RP signature is requested for the FROZEN join action. The client
    // pins 'bill:confirm' (PR #14 allowlist) — the caller string never rides.
    expect(calls[0]).toEqual({ url: '/api/rp-signature', body: { action: 'bill:confirm' } });

    // Leg 2: preset is ProofOfHuman with the fully-lowercased binding.
    expect(presetCalls).toEqual([
      {
        type: 'ProofOfHuman',
        signal: `${BILL}:${WALLET}`,
      },
    ]);

    // Leg 3: GOLDEN verify-proof body — the exact shape Harley's P0 flagged.
    expect(calls[1].url).toBe('/api/verify-proof');
    expect(calls[1].body).toEqual({
      rp_id: 'rp_test_1',
      idkitResponse: FAKE_PROOF,
      bill: BILL,
      wallet: WALLET,
    });

    // Granted proof => success feedback + host notified for badge refresh.
    expect(screen.getByTestId('feedback-label')).toHaveTextContent('Verified');
    expect(onVerified).toHaveBeenCalledWith(true);
  });

  it('portal-verified but NOT granted is a FAILED join (no fake success)', async () => {
    stubFetch({ success: true, granted: false, note: 'no seat context' });
    const onVerified = vi.fn();
    render(<Verify action="seat-join" seat={{ bill: BILL, wallet: WALLET }} onVerified={onVerified} />);
    clickVerify();
    await waitFor(() => expect(screen.getByTestId('feedback-label')).toHaveTextContent('Failed to verify'));
    expect(onVerified).toHaveBeenCalledWith(false);
  });

  it('invalid seat pair never starts a proof (zero fetch, zero nonce burn)', async () => {
    const calls = stubFetch({ success: true, granted: true });
    const onVerified = vi.fn();
    render(<Verify action="seat-join" seat={{ bill: BILL, wallet: 'not-a-wallet' }} onVerified={onVerified} />);
    clickVerify();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(false));
    expect(calls.length).toBe(0);
    expect(presetCalls.length).toBe(0);
  });

  it('demo regression: no seat keeps orbLegacy empty-signal + 2-field body', async () => {
    const calls = stubFetch({ success: true });
    render(<Verify action="test-action" />);
    clickVerify();
    await waitFor(() => expect(calls.length).toBe(2));
    expect(presetCalls).toEqual([{ type: 'OrbLegacy', signal: '' }]);
    expect(calls[1].body).toEqual({ rp_id: 'rp_test_1', idkitResponse: FAKE_PROOF });
    expect(screen.getByTestId('feedback-label')).toHaveTextContent('Verified');
  });
});

describe('Verify — W2-F1c byte-exact wire pins (PR #18 fold, issue #15)', () => {
  it('seat lane: client byte-sends bill:confirm — NOT the caller action', async () => {
    JoinStubFetch();
    const onVerified = vi.fn();
    render(
      <Verify
        action="test-action"
        seat={{ bill: BILL_IN, wallet: WALLET_IN }}
        onVerified={onVerified}
      />,
    );
    JoinClickVerify();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(true));

    // Pin 1+2: rp-signature byte-exact. The old bug died here (test-action
    // rode the wire); the frozen allowlist member that makes joins signable
    // is bill:confirm. Byte compare, not parsed compare — this IS the wire.
    expect(H.rpSigBodies).toHaveLength(1);
    expect(H.rpSigBodies[0]).toBe(GOLDEN_RP_BODY);

    // Pin 3: preset MUST be proofOfHuman bound to `${billL}:${walletL}` —
    // mixed-case inputs normalize to the lowercase pair the server keccaks.
    expect(presetCalls).toEqual([{ type: 'ProofOfHuman', signal: GOLDEN_SIGNAL }]);

    // Pin 4+5: verify-proof byte-exact body: rp_id, idkitResponse, bill,
    // wallet — in exactly this key order (F1b wire contract).
    expect(H.vpBodies).toHaveLength(1);
    expect(H.vpBodies[0]).toBe(GOLDEN_VP_BODY);
  });

  it('demo lane (no seat) stays template-identical: caller action, 2-field body', async () => {
    JoinStubFetch();
    const onVerified = vi.fn();
    render(<Verify action="test-action" onVerified={onVerified} />);
    JoinClickVerify();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(true));

    // Pin 6+7: the demo wire keeps the caller-supplied action and the
    // rp_id+idkitResponse-only body — no bill/wallet keys, orbLegacy signal.
    expect(H.rpSigBodies[0]).toBe(GOLDEN_DEMO_RP_BODY);
    expect(H.vpBodies[0]).toBe(GOLDEN_DEMO_VP_BODY);
    expect(presetCalls).toEqual([{ type: 'OrbLegacy', signal: '' }]);
  });
});
