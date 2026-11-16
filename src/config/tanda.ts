// Tanda W8 shell config — rehearsal targets (World Chain Sepolia 4801).
// Canonical provenance: tanda-sync @6c48e48 (DEPLOY_RECEIPT_V2.json, W6-V2 live E2E).
// W9 mainnet cutover flips only these env defaults (chain 480 + mainnet factory deploy).
import type { Address } from 'viem';

const addr = (v: string | undefined, d: Address): Address =>
  (v as Address) ?? d;

export const TANDA = {
  chainId: Number(process.env.NEXT_PUBLIC_TANDA_CHAIN_ID ?? 4801),
  rpcUrl:
    process.env.NEXT_PUBLIC_TANDA_RPC_URL ??
    'https://worldchain-sepolia.g.alchemy.com/public',
  // W6-V2 canonical clone factory (world.json pin, source-verified on 4801)
  factory: addr(process.env.NEXT_PUBLIC_TANDA_FACTORY,
    '0x70A5dC7Ea69D19618335D89d84a32c2a605c2Ac6'),
  implementation: addr(process.env.NEXT_PUBLIC_TANDA_IMPL,
    '0x1Cb98A8Cd9FF8058DD327d505bc80eC73Cca27A5'),
  // USDC on World Chain Sepolia — baked immutable in impl; recovered live from
  // smoke createBill calldata (tx 0xdbd8dd14…, decoded token arg).
  usdcSepolia: addr(process.env.NEXT_PUBLIC_TANDA_USDC,
    '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88'),
  // W5-era direct deploy (non-factory). Legacy bills stay live — shell must
  // support both eras: isBill()==false + getCode non-empty => legacy binding.
  legacyBill: addr(process.env.NEXT_PUBLIC_TANDA_LEGACY_BILL,
    '0x8644095B9722a41281314158006d194C59ab9b12'),
} as const;
