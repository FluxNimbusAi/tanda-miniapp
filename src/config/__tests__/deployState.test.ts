import { describe, expect, it } from 'vitest';

import { DEPLOY_STATE } from '../deployState';
import { TANDA } from '../tanda';

// UGLY-3 goldens (Flux ruling 2026-11-24): the app defaults must never drift
// from the signed deploy state again. Anchor values recomputed live from
// World Chain Sepolia 4801 on 2026-11-24 (Nimbus; keccak==DEPLOY_STATE lineage).
describe('config single-source — DEPLOY_STATE (UGLY-3)', () => {
  it('defaults to the V3 canonical factory/impl pair', () => {
    expect(TANDA.factory).toBe(DEPLOY_STATE.factory);
    expect(TANDA.implementation).toBe(DEPLOY_STATE.implementation);
    expect(TANDA.factory.toLowerCase()).toBe(
      '0x010872d47bd7bb001037577a15d090556bfd24c3',
    );
    expect(TANDA.implementation.toLowerCase()).toBe(
      '0xd0cc3595679a36b64c860568217b623605980e6a',
    );
  });

  it('pins the live-verified impl runtime keccak + size', () => {
    expect(DEPLOY_STATE.implRuntimeKeccak).toBe(
      '0x3683cfe0de28d6e06e53f74b6879789a81a6286a0ea1d69b1997880999eba0d8',
    );
    expect(DEPLOY_STATE.implRuntimeBytes).toBe(9817);
  });

  it('registers V3 factory first and keeps historical eras decodable', () => {
    expect(TANDA.knownFactories[0]).toBe(DEPLOY_STATE.factory);
    for (const hist of [
      '0x96B6Ebc35aD760561d26a6C57d5b3F491B524332',
      '0x65Ba0bB4959c2b6121d9e4Da822452aEEC6e61e6',
      '0x70A5dC7Ea69D19618335D89d84a32c2a605c2Ac6',
    ]) {
      expect(TANDA.knownFactories).toContain(hist as never);
    }
  });
});
