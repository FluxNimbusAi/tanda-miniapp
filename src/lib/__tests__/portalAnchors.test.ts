// PORTAL-RECON golden (t_70306450, Flux ruling 4): byte-pins for the two
// portal anchors plus the env-overridable confirm-action flag. The World MCP
// transport was CLOSED for this cycle, so these values are pinned from the
// portal RECORD, not a live read — a live read that contradicts them wins
// (ruling 4) and updates this file. See docs/adr/ADR-0010.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PORTAL_APP_ID, PORTAL_RP_ID } from '@/lib/portalAnchors';
import {
  BILL_RP_ACTIONS,
  CONFIRM_ACTION_DEFAULT,
  TANDA_CONFIRM_ACTION,
  resolveConfirmAction,
} from '@/lib/rpSignatureGuard';
import { SEAT_JOIN_ACTION } from '@/lib/seatJoin';
import { WORLD_APP_ID_RE } from '@/lib/inviteLink';

describe('portal anchors — single source (ruling 4)', () => {
  it('pins the portal-recorded rp_id byte-exact', () => {
    expect(PORTAL_RP_ID).toBe('rp_a779c304e4f624ce');
  });

  it('pins the portal-recorded app_id byte-exact and well-formed', () => {
    expect(PORTAL_APP_ID).toBe('app_e691f66620f3537878f639160a0e31f7');
    expect(WORLD_APP_ID_RE.test(PORTAL_APP_ID)).toBe(true);
  });
});

describe('confirm-action-name flag (ADR-0010 — NO flip without live read)', () => {
  it('unset env keeps the current wire value byte-exact', () => {
    expect(resolveConfirmAction(undefined)).toBe('bill:confirm');
    expect(resolveConfirmAction('')).toBe('bill:confirm');
    expect(resolveConfirmAction('   ')).toBe('bill:confirm');
    expect(CONFIRM_ACTION_DEFAULT).toBe('bill:confirm');
    expect(TANDA_CONFIRM_ACTION).toBe('bill:confirm');
    expect(SEAT_JOIN_ACTION).toBe('bill:confirm');
    expect([...BILL_RP_ACTIONS]).toContain(SEAT_JOIN_ACTION);
  });

  it('resolveConfirmAction trims and prefers the operator override', () => {
    expect(resolveConfirmAction(' tanda_bill_settlement ')).toBe('tanda_bill_settlement');
  });

  it('server oracle with TANDA_CONFIRM_ACTION set accepts ONLY the pinned name + enum', async () => {
    // The gate is module-init, so the override needs a fresh module graph.
    process.env.TANDA_CONFIRM_ACTION = 'tanda_bill_settlement';
    vi.resetModules();
    const guard = await import('@/lib/rpSignatureGuard');
    expect(guard.isBillRpAction('tanda_bill_settlement')).toBe(true);
    expect(guard.isBillRpAction('bill:execute')).toBe(true);
    expect(guard.isBillRpAction('arbitrary:verb')).toBe(false);
    expect(guard.isBillRpAction('Bill:Confirm')).toBe(false);
  });
});

afterEach(() => {
  delete process.env.TANDA_CONFIRM_ACTION;
  vi.resetModules();
});
