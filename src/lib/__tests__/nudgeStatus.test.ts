// P1.1b render lane (t_p11b_nudge_render): pure-logic tests for the nudge
// landing states. Clock anchors mirror the ratified engine copy moments
// (spec §3): N2 fires at initiatedAt+2h/+20h inside a 72h MAX_HOLD, N2c is
// the last-call at +60h..72h, N3a gates on fullyConfirmedAt+WINDOW.
import { describe, expect, it } from 'vitest';
import {
  formatNudgeDuration,
  nudgeLabel,
  nudgeStatus,
  type NudgeSnap,
  type NudgeStatusKind,
} from '@/lib/nudgeStatus';

const T = 1_800_000_000; // fixed "now" (chain-clock probe result)
const H = 3600;

const snap = (over: Partial<NudgeSnap> = {}): NudgeSnap => ({
  era: 'factory-w10',
  initiatedAt: BigInt(0),
  settledAt: BigInt(0),
  fullyConfirmedAt: BigInt(0),
  refunded: false,
  window: BigInt(H),
  maxHold: BigInt(72 * H),
  ...over,
});

describe('nudgeStatus — landing mirrors the push clock (spec §3)', () => {
  it('nothing pending (not initiated) renders nothing', () => {
    expect(nudgeStatus(snap(), T)).toBeNull();
  });

  it('N2 window: +20h into a 72h hold → refund-countdown, 52h left', () => {
    const st = nudgeStatus(snap({ initiatedAt: BigInt(T - 20 * H) }), T)!;
    expect(st).toEqual({ kind: 'refund-countdown', remainingSec: 52 * H });
    // KAIZEN-2 phase-honest copy: door language + money rule first.
    // (Engine push-string mirror rides a separate tanda branch — deliberate
    // divergence from the old "escrow auto-refunds" sentence, which lied:
    // nothing auto-runs; the refund door merely opens.)
    expect(nudgeLabel(st)).toBe(
      'Confirm now — cancel-early returns the escrow in full until the refund door opens in 52h',
    );
  });

  it('sub-hour remaining renders minutes, never 0h/0m', () => {
    const st = nudgeStatus(snap({ initiatedAt: BigInt(T - 71 * H - 13 * 60) }), T)!;
    expect(st.kind).toBe('refund-countdown');
    expect(st.remainingSec).toBe(47 * 60);
    expect(nudgeLabel(st)).toContain('47m');
    const edge = nudgeStatus(snap({ initiatedAt: BigInt(T - 72 * H + 30) }), T)!;
    expect(nudgeLabel(edge)).toContain('1m'); // 30s left rounds UP to 1m
  });

  it('MAX_HOLD horizon: strictly inside counts down, at/after flips to last call', () => {
    const inside = nudgeStatus(snap({ initiatedAt: BigInt(T - 72 * H + 1) }), T)!;
    expect(inside.kind).toBe('refund-countdown');
    const at = nudgeStatus(snap({ initiatedAt: BigInt(T - 72 * H) }), T)!;
    expect(at.kind).toBe('refund-horizon');
    expect(at.remainingSec).toBe(0);
    const past = nudgeStatus(snap({ initiatedAt: BigInt(T - 80 * H) }), T)!;
    expect(past.kind).toBe('refund-horizon');
    expect(nudgeLabel(past, '12.5')).toContain('12.5 USDC');
    expect(nudgeLabel(past)).toContain('Last call');
  });

  it('N3a: fully confirmed, window pending → execute-countdown', () => {
    const st = nudgeStatus(snap({
      initiatedAt: BigInt(T - 6 * H),
      fullyConfirmedAt: BigInt(T - 30 * 60),
    }), T)!;
    expect(st).toEqual({ kind: 'execute-countdown', remainingSec: 30 * 60 });
    expect(nudgeLabel(st)).toBe('All seats signed — settlement unlocks in ~30m, then anyone can execute');
  });

  it('window elapsed → executable with the verbatim N3a push copy', () => {
    const st = nudgeStatus(snap({
      initiatedAt: BigInt(T - 6 * H),
      fullyConfirmedAt: BigInt(T - H),
    }), T)!;
    expect(st).toEqual({ kind: 'executable', remainingSec: null });
    expect(nudgeLabel(st)).toBe(
      'Settlement is unlocked — one tap executes. Payouts split per the signed vector.',
    );
  });

  it('phase honesty: no chip copy may promise automatic movement (KAIZEN-2)', () => {
    // The old N2b/N3a sentences said "auto-refunds" / "executes in ~45m".
    // Services grep proved zero auto-callers, so chip copy is banned from
    // will/auto language and from the retired "confirmed" noun.
    const kinds: Array<[NudgeStatusKind, number | null, string]> = [
      ['refund-countdown', 52 * H, 'Confirm now — cancel-early returns the escrow in full until the refund door opens in 52h'],
      ['refund-horizon', 0, 'Last call: the refund door is open — the escrow returns to the funder in full and anyone can call it. Seats can still settle.'],
      ['execute-countdown', 30 * 60, 'All seats signed — settlement unlocks in ~30m, then anyone can execute'],
      ['executable', null, 'Settlement is unlocked — one tap executes. Payouts split per the signed vector.'],
    ];
    for (const [kind, remainingSec, expected] of kinds) {
      // Canonical form (no usdc passed) — escrow renders as 'the escrow'.
      const label = nudgeLabel({ kind, remainingSec });
      expect(label).toBe(expected);
      expect(label).not.toMatch(/auto/i);
      expect(label).not.toMatch(/\bconfirmed\b/i);
    }
    // Amount threading: when the app knows the figure, it lands in the rule.
    expect(nudgeLabel({ kind: 'refund-countdown', remainingSec: 52 * H }, '12.5'))
      .toContain('12.5 USDC');
  });

  it('terminal states stay silent even with stale timers (engine §6 cases 1–2)', () => {
    expect(nudgeStatus(snap({
      initiatedAt: BigInt(T - 10 * H), settledAt: BigInt(T - H),
    }), T)).toBeNull();
    expect(nudgeStatus(snap({
      initiatedAt: BigInt(T - 10 * H), refunded: true,
    }), T)).toBeNull();
    expect(nudgeStatus(snap({
      initiatedAt: BigInt(T - 10 * H), settledAt: BigInt(T - H),
      fullyConfirmedAt: BigInt(T - 2 * H),
    }), T)).toBeNull();
  });

  it('era scope: legacy/unknown never render (no MAX_HOLD/fullyConfirmedAt); factory-v2 does', () => {
    expect(nudgeStatus(snap({ era: 'legacy', initiatedAt: BigInt(T - H) }), T)).toBeNull();
    expect(nudgeStatus(snap({ era: 'unknown', initiatedAt: BigInt(T - H) }), T)).toBeNull();
    const v2 = nudgeStatus(snap({ era: 'factory-v2', initiatedAt: BigInt(T - 20 * H) }), T)!;
    expect(v2.kind).toBe('refund-countdown');
  });
});

describe('formatNudgeDuration', () => {
  it('floors to hours above the boundary, minutes below', () => {
    expect(formatNudgeDuration(25 * 3600 + 59 * 60 + 59)).toBe('25h');
    expect(formatNudgeDuration(3599)).toBe('59m');
    expect(formatNudgeDuration(0)).toBe('1m'); // floor never shows "0m"
  });
});
