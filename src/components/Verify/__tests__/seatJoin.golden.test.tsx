// @vitest-environment jsdom
// W2-F1 golden (t_92a43849): pins the REAL JOIN wire contract Harley's P0
// found missing — preset must be proofOfHuman bound to `${bill}:${wallet}`
// (both lowercase) and the verify-proof POST body must carry bill+wallet next
// to { rp_id, idkitResponse }. Demo path regression: unchanged orbLegacy with
// empty signal and the two-field body. IDKit and the ui-kit are pass-through
// mocks; the payload shape is the subject under test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { presetCalls, FAKE_PROOF } = vi.hoisted(() => ({
  presetCalls: [] as unknown[],
  FAKE_PROOF: {
    protocol_version: '4',
    nonce: 'nonce-abc',
    action: 'seat-join',
    responses: [{ nullifier: 'nullifier_xyz', signal_hash: '0xdead' }],
  },
}));

vi.mock('@worldcoin/idkit', () => ({
  IDKit: {
    // IDKit 4.1.2 calls request(...) synchronously and chains .preset() on
    // the returned builder (dist/index.js:326) — the mock must mirror that.
    request: vi.fn(() => ({
      preset: (p: unknown) => {
        presetCalls.push(p);
        return {
          pollUntilCompletion: async () => ({ success: true, result: FAKE_PROOF }),
        };
      },
    })),
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

afterEach(() => {
  cleanup();
  presetCalls.length = 0;
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

    // Leg 1: RP signature is requested for the join action.
    expect(calls[0]).toEqual({ url: '/api/rp-signature', body: { action: 'seat-join' } });

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
