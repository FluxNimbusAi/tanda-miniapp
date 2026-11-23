// Tanda W8 shell config — rehearsal targets (World Chain Sepolia 4801).
// Canonical provenance: FROZEN W10 pair (main @17a34e2b; live runtime shas in
// tanda docs/W10_E2E_RECEIPT_20261116.md + PR#2; both source-verified on Worldscan).
// W9 mainnet cutover flips only these env defaults (chain 480 + mainnet factory deploy).
import type { Address } from 'viem';

const addr = (v: string | undefined, d: Address): Address =>
  (v as Address) ?? d;

export const TANDA = {
  chainId: Number(process.env.NEXT_PUBLIC_TANDA_CHAIN_ID ?? 4801),
  rpcUrl:
    process.env.NEXT_PUBLIC_TANDA_RPC_URL ??
    'https://worldchain-sepolia.g.alchemy.com/public',
  // W10 canonical FROZEN pair: forwarder factory (callBill) + rotate-capable impl.
  // ALL bill writes target this factory — clones are never client targets
  // (MiniKit invalid_contract entrypoint gate, audit correction #1).
  factory: addr(process.env.NEXT_PUBLIC_TANDA_FACTORY,
    '0x96B6Ebc35aD760561d26a6C57d5b3F491B524332'),
  implementation: addr(process.env.NEXT_PUBLIC_TANDA_IMPL,
    '0xD33A44fC56Fb859be08a8aAc5Cc26Cd2a27D47c6'),
  // Era lineage for probeBill: which factory minted a bill decides its ABI.
  //   W10 pair above -> rotate-capable, forwarder era
  //   fast twin 0x65Ba0bB4 / 0x52d2b14c -> same code, 60s/120s constants (rehearsal bills)
  //   pre-forwarder 0x70A5dC7E / 0x1Cb98A8C -> V2 ABI minus rotate/callBill
  //   not in any registry + has code -> W5 legacy V1 (runtime-locked 0x8644…b12)
  knownFactories: [
    '0x96B6Ebc35aD760561d26a6C57d5b3F491B524332',
    '0x65Ba0bB4959c2b6121d9e4Da822452aEEC6e61e6',
    '0x70A5dC7Ea69D19618335D89d84a32c2a605c2Ac6',
  ] as Address[],
  // USDC on World Chain Sepolia — frozen; approve stays a DIRECT client call
  // (spender is the clone; USDC is the second portal entrypoint).
  usdcSepolia: addr(process.env.NEXT_PUBLIC_TANDA_USDC,
    '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88'),
  // W5-era direct deploy (non-factory). Legacy bills stay live — shell must
  // support both eras: isBill()==false + getCode non-empty => legacy binding.
  legacyBill: addr(process.env.NEXT_PUBLIC_TANDA_LEGACY_BILL,
    '0x8644095B9722a41281314158006d194C59ab9b12'),
} as const;
