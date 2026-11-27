// P1.1b render lane (t_p11b_nudge_render): golden markup for the countdown
// chip (node env, renderToString — same lane shape as the P0.3 SeatBadge
// goldens). Pins aria contract + the exact landing copy per state.
// KAIZEN-2 LAW CHANGE (H2/H3, recon ledger bridge/KAIZEN_RECON_BASE_SOLANA_20261127.md):
// copy moved from engine-mirror strings to phase-honest door language —
// refunds are permissionless doors, not timers that "auto" move money; seats
// SIGN, execution UNLOCKS. Old strings said "auto-refunds"/"executes itself",
// which misdescribes contract reality; goldens amended, not deleted.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NudgeCountdown } from '@/components/NudgeCountdown';
import type { NudgeStatus } from '@/lib/nudgeStatus';

const H = 3600;

const GOLDEN: Array<{ st: NudgeStatus; usdc?: string; text: string; tone: string }> = [
  {
    st: { kind: 'refund-countdown', remainingSec: 52 * H },
    text: 'Confirm now — cancel-early returns the escrow in full until the refund door opens in 52h',
    tone: 'amber',
  },
  {
    st: { kind: 'refund-horizon', remainingSec: 0 },
    usdc: '3.75',
    text: 'Last call: the refund door is open — 3.75 USDC returns to the funder in full and anyone can call it. Seats can still settle.',
    tone: 'amber',
  },
  {
    st: { kind: 'execute-countdown', remainingSec: 55 * 60 },
    text: 'All seats signed — settlement unlocks in ~55m, then anyone can execute',
    tone: 'emerald',
  },
  {
    st: { kind: 'executable', remainingSec: null },
    text: 'Settlement is unlocked — one tap executes. Payouts split per the signed vector.',
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
