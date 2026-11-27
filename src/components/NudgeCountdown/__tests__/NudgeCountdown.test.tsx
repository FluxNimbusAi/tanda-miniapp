// P1.1b render lane (t_p11b_nudge_render): golden markup for the countdown
// chip (node env, renderToString — same lane shape as the P0.3 SeatBadge
// goldens). Pins aria contract + the exact landing copy per state.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NudgeCountdown } from '@/components/NudgeCountdown';
import type { NudgeStatus } from '@/lib/nudgeStatus';

const H = 3600;

const GOLDEN: Array<{ st: NudgeStatus; usdc?: string; text: string; tone: string }> = [
  {
    st: { kind: 'refund-countdown', remainingSec: 52 * H },
    text: 'Settlement expires in 52h — confirm now or escrow auto-refunds',
    tone: 'amber',
  },
  {
    st: { kind: 'refund-horizon', remainingSec: 0 },
    usdc: '3.75',
    text: 'Last call: escrow 3.75 USDC returns to the funder on refund — confirm now',
    tone: 'amber',
  },
  {
    st: { kind: 'execute-countdown', remainingSec: 55 * 60 },
    text: 'All seats confirmed — settlement executes in ~55m',
    tone: 'emerald',
  },
  {
    st: { kind: 'executable', remainingSec: null },
    text: 'All seats confirmed — settlement is ready. One tap to open payouts.',
    tone: 'emerald',
  },
];

describe('NudgeCountdown golden render', () => {
  for (const g of GOLDEN) {
    it(`renders ${g.st.kind} with exact copy, status semantics, and ${g.tone} tone`, () => {
      const html = renderToString(
        createElement(NudgeCountdown, { status: g.st, usdc: g.usdc }),
      );
      expect(html).toContain(`data-kind="${g.st.kind}"`);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(g.text);
      expect(html).toContain(g.tone);
    });
  }
});
