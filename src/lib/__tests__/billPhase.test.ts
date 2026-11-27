// KAIZEN-2 (H2/H3) — golden matrix for the canonical bill phase machine.
// One noun per phase, money rule stated BEFORE the next action, and honest
// deadlines only: legacy-era snaps get null timers (never a fake tick),
// terminal phases prompt nothing, and NO derived copy may promise automatic
// movement (services grep proved zero auto-callers — doors open, nobody pushes).
import { describe, it, expect } from 'vitest';
import {
  billPhase,
  PHASE_ORDER,
  TERMINAL_PHASES,
  formatNudgeDuration,
  type PhaseSnap,
} from '../billPhase';

const H = 3600;
const T = 1_700_000_000; // fixed nowSec — pure arithmetic, no Date reads.

const snap = (over: Partial<PhaseSnap> = {}): PhaseSnap => ({
  era: 'factory-v2',
  initiatedAt: BigInt(0),
  settledAt: BigInt(0),
  fullyConfirmedAt: BigInt(0),
  refunded: false,
  window: BigInt(1 * H),
  maxHold: BigInt(72 * H),
  ...over,
});

describe('billPhase — H3 lifecycle spine', () => {
  it('forward spine is exactly draft->funded->initiated->window->executable', () => {
    expect(PHASE_ORDER).toEqual(['draft', 'funded', 'initiated', 'window', 'executable']);
    expect(TERMINAL_PHASES).toEqual(['settled', 'refunded']);
  });
});

describe('billPhase — pre-initiation states', () => {
  it('no escrow -> draft: funds first, nothing has moved', () => {
    const p = billPhase(snap(), T);
    expect(p.phase).toBe('draft');
    expect(p.label).toBe('Draft');
    expect(p.nextLegalAction).toBe('Fund escrow');
    expect(p.remainingSec).toBeNull();
    expect(p.moneyRule).toContain('Nothing has moved yet');
  });

  it('escrow>0 -> funded: locked, moves only per terms', () => {
    const p = billPhase(snap({ escrow: BigInt(12_500_000) }), T);
    expect(p.phase).toBe('funded');
    expect(p.label).toBe('Funded');
    expect(p.nextLegalAction).toBe('Initiate settlement');
    expect(p.moneyRule).toContain('never by app action');
  });
});

describe('billPhase — H2 money rule before action (initiated, seats signing)', () => {
  it('factory inside MAX_HOLD -> refund door countdown, cancel-early = full return', () => {
    const p = billPhase(snap({ initiatedAt: BigInt(T - 20 * H) }), T);
    expect(p.phase).toBe('initiated');
    expect(p.label).toBe('Awaiting signatures');
    expect(p.remainingSec).toBe(52 * H);
    expect(p.refundDoorOpen).toBe(false);
    expect(p.moneyRule).toContain('Refund door opens in 52h');
    expect(p.nextLegalAction).toBe('Confirm my seat');
  });

  it('factory past MAX_HOLD -> refund door OPEN, permissive language, last call', () => {
    const p = billPhase(snap({ initiatedAt: BigInt(T - 80 * H) }), T);
    expect(p.phase).toBe('initiated');
    expect(p.label).toBe('Refund door open');
    expect(p.refundDoorOpen).toBe(true);
    expect(p.remainingSec).toBe(0);
    expect(p.moneyRule).toContain('returns to the funder in full');
    expect(p.nextLegalAction).toBe('Refund settlement (permissionless)');
  });

  it('legacy W5 (zero clocks) -> no invented deadline, null remainingSec', () => {
    const p = billPhase(
      snap({ era: 'legacy-w5', initiatedAt: BigInt(T - 100 * H), maxHold: BigInt(0) }),
      T,
    );
    expect(p.phase).toBe('initiated');
    expect(p.remainingSec).toBeNull();
    expect(p.refundDoorOpen).toBe(false);
    expect(p.nextLegalAction).toBe('Confirm my seat');
  });
});

describe('billPhase — settlement window & executability', () => {
  it('all signed inside window -> window phase with unlock math + committed money rule', () => {
    const p = billPhase(snap({
      initiatedAt: BigInt(T - 5 * H),
      fullyConfirmedAt: BigInt(T - 30 * 60),
    }), T);
    expect(p.phase).toBe('window');
    expect(p.label).toBe('All signed — window');
    expect(p.remainingSec).toBe(30 * 60);
    expect(p.moneyRule).toContain('splits stay per terms');
    expect(p.nextLegalAction).toContain('Execution unlocks in ~30m');
  });

  it('window elapsed -> executable, permissionless settle, no countdown', () => {
    const p = billPhase(snap({
      initiatedAt: BigInt(T - 5 * H),
      fullyConfirmedAt: BigInt(T - 2 * H),
    }), T);
    expect(p.phase).toBe('executable');
    expect(p.label).toBe('Executable');
    expect(p.remainingSec).toBeNull();
    expect(p.nextLegalAction).toBe('Settle now (permissionless)');
  });
});

describe('billPhase — terminals owned by on-chain events', () => {
  it('settledAt>0 -> Executed, split-per-vector, nothing to prompt', () => {
    const p = billPhase(snap({
      initiatedAt: BigInt(T - 5 * H),
      fullyConfirmedAt: BigInt(T - 2 * H),
      settledAt: BigInt(T - H),
    }), T);
    expect(p.phase).toBe('settled');
    expect(p.label).toBe('Executed');
    expect(p.nextLegalAction).toBe('');
    expect(p.moneyRule).toContain('signed vector');
  });

  it('refunded wins over settledAt (terminal precedence)', () => {
    const p = billPhase(snap({
      initiatedAt: BigInt(T - 5 * H),
      settledAt: BigInt(T - H),
      refunded: true,
    }), T);
    expect(p.phase).toBe('refunded');
    expect(p.label).toBe('Refunded');
    expect(p.nextLegalAction).toBe('');
    expect(p.moneyRule).toContain('in full');
  });
});

describe('billPhase — phase honesty invariants (H2/H3)', () => {
  const states: Array<PhaseSnap> = [
    snap(),
    snap({ escrow: BigInt(1) }),
    snap({ initiatedAt: BigInt(T - 20 * H) }),
    snap({ initiatedAt: BigInt(T - 80 * H) }),
    snap({ era: 'legacy-w5', initiatedAt: BigInt(T - H), maxHold: BigInt(0) }),
    snap({ initiatedAt: BigInt(T - 5 * H), fullyConfirmedAt: BigInt(T - 30 * 60) }),
    snap({ initiatedAt: BigInt(T - 5 * H), fullyConfirmedAt: BigInt(T - 2 * H) }),
    snap({ initiatedAt: BigInt(T - 5 * H), settledAt: BigInt(T - H) }),
    snap({ refunded: true }),
  ];
  it('no derived copy may say auto/confirmed/will — doors open, seats sign', () => {
    for (const s of states) {
      const p = billPhase(s, T);
      const blob = `${p.label} ${p.moneyRule} ${p.nextLegalAction}`;
      expect(blob).not.toMatch(/\bauto\b/i);
      expect(blob).not.toMatch(/\bconfirmed\b/i);
      expect(blob).not.toMatch(/\bwill (refund|execute|settle)\b/i);
    }
  });

  it('usdc amount threads into the money rule when known', () => {
    const p = billPhase(snap({ initiatedAt: BigInt(T - 80 * H) }), T, '12.5');
    expect(p.moneyRule).toContain('12.5 USDC');
  });
});

describe('formatNudgeDuration — coarse clock', () => {
  it('h/m rounding matches chip copy', () => {
    expect(formatNudgeDuration(52 * H)).toBe('52h');
    expect(formatNudgeDuration(30 * 60)).toBe('30m');
    expect(formatNudgeDuration(59)).toBe('1m'); // floor never reads "0m"
    expect(formatNudgeDuration(-5)).toBe('1m'); // clamped, no negative tick
  });
});
