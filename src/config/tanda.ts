// Tanda shell config — rehearsal targets (World Chain Sepolia 4801).
// UGLY-3 re-freeze (Flux ruling 2026-11-24, DIRECTOR'S AUDIT ①): defaults now
// single-sourced from ./deployState.ts — the canonical V3 hardened pair that
// docs/DEPLOY_STATE.json (tanda repo) and tandabill.world both cite.
// The old W10 pair (0x96B6…/0xD33A…) stays registered in knownFactories as a
// HISTORICAL era: bills minted there predate pull-claim (no claimSettlement
// selector — live-probed 2026-11-24) and must keep decoding correctly.
// W9 mainnet cutover flips only these env defaults (chain 480 + mainnet factory deploy).
import type { Address } from 'viem';

import { DEPLOY_STATE } from './deployState';

const addr = (v: string | undefined, d: Address): Address =>
  (v as Address) ?? d;

export const TANDA = {
  chainId: Number(process.env.NEXT_PUBLIC_TANDA_CHAIN_ID ?? DEPLOY_STATE.chainId),
  rpcUrl:
    process.env.NEXT_PUBLIC_TANDA_RPC_URL ??
    'https://worldchain-sepolia.g.alchemy.com/public',
  // V3 canonical pair (DEPLOY_STATE single source): forwarder factory
  // (callBill) + pull-claim + rotate-capable impl. ALL new bill writes
  // target this factory — clones are never client targets (MiniKit
  // invalid_contract entrypoint gate, audit correction #1).
  factory: addr(process.env.NEXT_PUBLIC_TANDA_FACTORY, DEPLOY_STATE.factory),
  implementation: addr(
    process.env.NEXT_PUBLIC_TANDA_IMPL,
    DEPLOY_STATE.implementation,
  ),
  // Era lineage for probeBill: which factory minted a bill decides its ABI.
  //   V3 pair (DEPLOY_STATE)              -> pull-claim + rotate + forwarder era (canonical)
  //   W10 pair 0x96B6Ebc3…                -> rotate-capable, forwarder era, NO pull-claim
  //   fast twin 0x65Ba0bB4 / 0x52d2b14c -> same code, 60s/120s constants (rehearsal bills)
  //   pre-forwarder 0x70A5dC7E / 0x1Cb98A8C -> V2 ABI minus rotate/callBill
  //   not in any registry + has code -> W5 legacy V1 (runtime-locked 0x8644…b12)
  knownFactories: [
    DEPLOY_STATE.factory,
    '0x96B6Ebc35aD760561d26a6C57d5b3F491B524332',
    '0x65Ba0bB4959c2b6121d9e4Da822452aEEC6e61e6',
    '0x70A5dC7Ea69D19618335D89d84a32c2a605c2Ac6',
  ] as Address[],
  // USDC on World Chain Sepolia — frozen; approve stays a DIRECT client call
  // (spender is the clone; USDC is the second portal entrypoint).
  usdcSepolia: addr(process.env.NEXT_PUBLIC_TANDA_USDC, DEPLOY_STATE.usdc),
  // W5-era direct deploy (non-factory). Legacy bills stay live — shell must
  // support both eras: isBill()==false + getCode non-empty => legacy binding.
  legacyBill: addr(process.env.NEXT_PUBLIC_TANDA_LEGACY_BILL,
    '0x8644095B9722a41281314158006d194C59ab9b12'),
} as const;
