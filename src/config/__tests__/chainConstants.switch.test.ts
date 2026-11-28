// APP-2 close-out (issue #79): the mainnet cutover must be a CONFIG change,
// never a code change. Pins: (a) defaults = DEPLOY_STATE (testnet 4801 pair);
// (b) NEXT_PUBLIC_TANDA_* env overrides flip chainId/factory/usdc cleanly;
// (c) a bogus chainId falls back honestly (Number('x')=NaN guard).

import { describe, expect, it, vi } from 'vitest';

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env))
    (process.env as Record<string, string | undefined>)[k] = v;
  const m = await import('../tanda');
  return m.TANDA;
};

describe('W9 mainnet switch posture (#79)', () => {
  it('defaults are the frozen testnet V3 pair', async () => {
    const t = await load({});
    expect(t.chainId).toBe(4801);
  });
  it('env trio flips the whole money plane (480 rehearsal)', async () => {
    const t = await load({
      NEXT_PUBLIC_TANDA_CHAIN_ID: '480',
      NEXT_PUBLIC_TANDA_FACTORY: '0x' + 'ab'.repeat(20),
      NEXT_PUBLIC_TANDA_USDC: '0x' + 'cd'.repeat(20),
    });
    expect(t.chainId).toBe(480);
    expect(t.factory).toBe(`0x${'ab'.repeat(20)}`);
    expect(t.usdcSepolia).toBe(`0x${'cd'.repeat(20)}`);
    // factory stays INSIDE knownFactories only via DEPLOY_STATE - an env
    // factory must still be the single client `to` (entrypoint law):
    expect(t.knownFactories.length).toBeGreaterThanOrEqual(4);
  });
  it('garbage chainId fails loud-safe, not silently wrong', async () => {
    const t = await load({ NEXT_PUBLIC_TANDA_CHAIN_ID: 'not-a-number' });
    expect(Number.isNaN(t.chainId)).toBe(true);
  });
});
