// PORTAL-RECON golden (t_70306450, Flux ruling 4): byte-pins for the two
// portal anchors plus the env-overridable confirm-action flag. The World MCP
// transport was CLOSED for that cycle, so those values were pinned from the
// portal RECORD, not a live read. ACTION-FLIP (t_7f0f9775): a LIVE MCP read
// followed (t_31f09cee — action_v4_62c3d88d2282da0810928cbafe0a88ef =
// SUPERSEDED 2026-11-26 by rotation ids 590146b1/staging + d9aa3f47/prod;
// 'tanda_bill_settlement' on rp_4fbd445435612f67), the default flipped, and
// this file was updated per ruling 4: "a live read that contradicts them
// wins". See docs/adr/ADR-0010.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PORTAL_APP_ID, PORTAL_RP_ID } from '@/lib/portalAnchors';
import {
  BILL_RP_ACTIONS,
  CONFIRM_ACTION_DEFAULT,
  TANDA_CONFIRM_ACTION,
  isBillRpAction,
  resolveConfirmAction,
} from '@/lib/rpSignatureGuard';
import { SEAT_JOIN_ACTION } from '@/lib/seatJoin';
import { WORLD_APP_ID_RE } from '@/lib/inviteLink';

describe('portal anchors — single source (ruling 4)', () => {
  it('pins the portal-recorded rp_id byte-exact', () => {
    expect(PORTAL_RP_ID).toBe('rp_4fbd445435612f67');
  });

  it('pins the portal-recorded app_id byte-exact and well-formed', () => {
    expect(PORTAL_APP_ID).toBe('app_d3f03e8bce15b7c4580069bf4ea882c2');
    expect(WORLD_APP_ID_RE.test(PORTAL_APP_ID)).toBe(true);
  });
});

describe('confirm-action flag (ADR-0010 — FLIPPED t_7f0f9775 on live MCP read)', () => {
  it('default (unset) env resolves to the live portal name, byte-exact', () => {
    expect(resolveConfirmAction(undefined)).toBe('tanda_bill_settlement');
    expect(resolveConfirmAction('')).toBe('tanda_bill_settlement');
    expect(resolveConfirmAction('   ')).toBe('tanda_bill_settlement');
    expect(CONFIRM_ACTION_DEFAULT).toBe('tanda_bill_settlement');
    expect(TANDA_CONFIRM_ACTION).toBe('tanda_bill_settlement');
    expect(SEAT_JOIN_ACTION).toBe('tanda_bill_settlement');
    expect([...BILL_RP_ACTIONS]).toContain(SEAT_JOIN_ACTION);
  });

  it('dual-accept during the transition: legacy bill:confirm stays accepted', async () => {
    // No env: the frozen enum carries BOTH names, so artifacts signed pre-
    // flip still verify and a bill:confirm request still gets a signature.
    expect(isBillRpAction('bill:confirm')).toBe(true);
    expect(isBillRpAction('tanda_bill_settlement')).toBe(true);
    expect(isBillRpAction('arbitrary:verb')).toBe(false);
    expect(isBillRpAction('Bill:Confirm')).toBe(false);
  });

  it('resolveConfirmAction trims and prefers the operator override', () => {
    expect(resolveConfirmAction(' tanda_bill_settlement ')).toBe('tanda_bill_settlement');
    expect(resolveConfirmAction('bill:confirm')).toBe('bill:confirm');
  });

  it('legacy-env pin rolls the default back and keeps the gate closed', async () => {
    // The gate is module-init, so the override needs a fresh module graph.
    process.env.TANDA_CONFIRM_ACTION = 'bill:confirm';
    vi.resetModules();
    const guard = await import('@/lib/rpSignatureGuard');
    expect(guard.TANDA_CONFIRM_ACTION).toBe('bill:confirm');
    expect(guard.isBillRpAction('bill:confirm')).toBe(true);
    expect(guard.isBillRpAction('tanda_bill_settlement')).toBe(true);
    expect(guard.isBillRpAction('arbitrary:verb')).toBe(false);
  });

  it('server oracle with TANDA_CONFIRM_ACTION set accepts ONLY the pinned name + enum', async () => {
    process.env.TANDA_CONFIRM_ACTION = 'tanda_bill_settlement';
    vi.resetModules();
    const guard = await import('@/lib/rpSignatureGuard');
    expect(guard.isBillRpAction('tanda_bill_settlement')).toBe(true);
    expect(guard.isBillRpAction('bill:execute')).toBe(true);
    expect(guard.isBillRpAction('arbitrary:verb')).toBe(false);
    expect(guard.isBillRpAction('Bill:Confirm')).toBe(false);
  });

  it('client leg: canonical NEXT_PUBLIC_CONFIRM_ACTION beats the legacy alias', async () => {
    process.env.NEXT_PUBLIC_CONFIRM_ACTION = 'tanda_bill_settlement';
    process.env.NEXT_PUBLIC_TANDA_CONFIRM_ACTION = 'bill:confirm';
    vi.resetModules();
    const sj = await import('@/lib/seatJoin');
    expect(sj.SEAT_JOIN_ACTION).toBe('tanda_bill_settlement');
  });

  it('client leg: legacy alias alone still pins (back-compat with #29)', async () => {
    process.env.NEXT_PUBLIC_TANDA_CONFIRM_ACTION = 'bill:confirm';
    vi.resetModules();
    const sj = await import('@/lib/seatJoin');
    expect(sj.SEAT_JOIN_ACTION).toBe('bill:confirm');
  });
});

afterEach(() => {
  delete process.env.TANDA_CONFIRM_ACTION;
  delete process.env.NEXT_PUBLIC_CONFIRM_ACTION;
  delete process.env.NEXT_PUBLIC_TANDA_CONFIRM_ACTION;
  vi.resetModules();
});
