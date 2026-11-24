// UGLY-3 config re-freeze: canonical deploy coordinates single-sourced from the
// tanda repo docs/DEPLOY_STATE.json (V3 hardening, 2026-11-21) — same
// single-source doctrine as portalAnchors.ts (ruling 4, ADR-0010).
// Adjudicated by: Flux assignment 2026-11-24 (DIRECTOR'S AUDIT ruling ①).
// Chain: World Chain Sepolia 4801. W9 mainnet cutover flips only the env vars.
//
// Live-verified 2026-11-24 (Nimbus, alchemy /public):
//   eth_getCode(impl) = 9817 B, keccak256 == IMPL_RUNTIME_KECCAK below
//   == tanda proofs/_v3_impl_runtime.hex byte-exact == DEPLOY_STATE lineage.
import type { Address } from 'viem';

export const DEPLOY_STATE = {
  chainId: 4801,
  factory: '0x010872d47bd7bb001037577a15d090556bfd24c3' as Address,
  implementation: '0xd0cc3595679a36b64c860568217b623605980e6a' as Address,
  implRuntimeKeccak:
    '0x3683cfe0de28d6e06e53f74b6879789a81a6286a0ea1d69b1997880999eba0d8',
  implRuntimeBytes: 9817,
  sourceMainSha: '0e3966dc9ba5f3f9c71107684645b7586826b50e',
  usdc: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88' as Address,
  provenance:
    'FluxNimbusAi/tanda docs/DEPLOY_STATE.json + proofs/DEPLOY_RECEIPT_V3_HARDENED_20261121.json',
} as const;
