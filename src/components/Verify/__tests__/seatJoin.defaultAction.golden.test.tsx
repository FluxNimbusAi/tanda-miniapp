// @vitest-environment jsdom
// ACTION-FLIP DUAL GOLDEN — DEFAULT-ENV case (t_7f0f9775, Flux ruling 19:0x).
// No confirm-action env is set (hoisted deletes both names for hermeticity),
// so SEAT_JOIN_ACTION resolves to the live portal name 'tanda_bill_settlement'
// (live MCP readback t_31f09cee: action_v4_62c3d88d2282da0810928cbafe0a88ef,
// rp_a779c304e4f624ce). Golden mirrors seatJoin.golden.test.tsx (the LEGACY-
// ENV case pinning 'bill:confirm'): same capture machinery, byte-exact pins,
// literals hand-written — the test IS the contract. CI green = BOTH files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Hermetic default-env: vi.hoisted runs BEFORE module imports, so
// @/lib/seatJoin resolves SEAT_JOIN_ACTION with no operator pin. A test
// worker reused from seatJoin.golden.test.tsx would otherwise leak the
// legacy pin into this module graph — deleting here makes the two goldens
// order-independent.
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_CONFIRM_ACTION;
  delete process.env.NEXT_PUBLIC_TANDA_CONFIRM_ACTION;
});

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
import { SEAT_JOIN_ACTION } from '@/lib/seatJoin';

// --- byte-exact default-env pins (hand-written; the flipped wire) ----------
const BILL_IN = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
const BILL_L = '0xabcdef1234567890abcdef1234567890abcdef12';
const WALLET_IN = '0xFEEDBEEF0123456789feadb0000000000000beef';
const WALLET_L = '0xfeedbeef0123456789feadb0000000000000beef';
const RP_SIG = { rp_id: 'rp_test_1', sig: 's', nonce: 'n-1', created_at: 1, expires_at: 2 };

// The portal-registered action name, byte-pinned post-FLIP. Legacy
// 'bill:confirm' rides the SAME wire only under an explicit env pin — see
// seatJoin.golden.test.tsx.
const GOLDEN_RP_BODY = '{"action":"tanda_bill_settlement"}';
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

function stubFetch() {
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

const clickVerify = () =>
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

describe('Verify — ACTION-FLIP default-env golden (tanda_bill_settlement)', () => {
  it('default (unset) env resolves the seat action to the live portal name', () => {
    // Byte pin by design: LITERAL, not the constant — if the default drifts
    // off the portal record this golden must FAIL, not silently follow.
    expect(SEAT_JOIN_ACTION).toBe('tanda_bill_settlement');
  });

  it('seat lane: client byte-sends tanda_bill_settlement on BOTH legs', async () => {
    stubFetch();
    const onVerified = vi.fn();
    render(
      <Verify
        action="test-action"
        seat={{ bill: BILL_IN, wallet: WALLET_IN }}
        onVerified={onVerified}
      />,
    );
    clickVerify();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(true));

    // Pin 1: rp-signature byte-exact — the portal name now rides the oracle
    // leg. Byte compare, not parsed compare — this IS the wire.
    expect(H.rpSigBodies).toHaveLength(1);
    expect(H.rpSigBodies[0]).toBe(GOLDEN_RP_BODY);

    // Pin 2: IDKit.request action byte-exact — signed message and proof must
    // carry the SAME string (SR-F1KP; external_nullifier derives from
    // app_id+action, so a split between legs fails portal verification).
    expect(H.requestCfgs).toHaveLength(1);
    expect(H.requestCfgs[0]!.action).toBe('tanda_bill_settlement');

    // Pin 2c: request action, rp-body action and the SINGLE exported
    // constant agree — one string, all legs, no local dupes.
    expect(H.requestCfgs[0]!.action).toBe(SEAT_JOIN_ACTION);
    expect(JSON.parse(H.rpSigBodies[0]!).action).toBe(SEAT_JOIN_ACTION);

    // Pin 3: preset MUST be proofOfHuman bound to `${billL}:${walletL}`.
    expect(presetCalls).toEqual([{ type: 'ProofOfHuman', signal: GOLDEN_SIGNAL }]);

    // Pin 4+5: verify-proof byte-exact body — key order is the F1b contract.
    expect(H.vpBodies).toHaveLength(1);
    expect(H.vpBodies[0]).toBe(GOLDEN_VP_BODY);
  });

  it('demo lane (no seat) is untouched by the flip: caller action, 2-field body', async () => {
    stubFetch();
    const onVerified = vi.fn();
    render(<Verify action="test-action" onVerified={onVerified} />);
    clickVerify();
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(true));

    expect(H.rpSigBodies[0]).toBe(GOLDEN_DEMO_RP_BODY);
    expect(H.vpBodies[0]).toBe(GOLDEN_DEMO_VP_BODY);
    expect(presetCalls).toEqual([{ type: 'OrbLegacy', signal: '' }]);
    expect(H.requestCfgs).toHaveLength(1);
    expect(H.requestCfgs[0]!.action).toBe('test-action');
  });
});
