import type { Metadata } from "next";
import Link from "next/link";

// C4 SHARE DEEP-LINK page: /bill/0x… = someone's public settlement trail,
// the growth-loop surface (UX-3 #9). Server shell renders instantly (SSR
// discipline from #52); the ledger itself loads client-side from
// /api/bills-for — honest empty state when the indexer lane is absent.
// Testnet badge formalized per UX-3 #7: this page NEVER implies real funds.

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function generateMetadata(): Metadata {
  return {
    title: "Tanda — public settlement trail",
    description:
      "On-chain settlement history for one World Chain wallet. Testnet data; not real funds.",
  };
}

export default async function BillProfile({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const valid = ADDRESS_RE.test(address);
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10"
      data-testid="bill-profile"
    >
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
          Tanda
        </p>
        <h1 className="text-xl font-semibold">Public settlement trail</h1>
        <span
          className="w-fit rounded-full border border-amber-400/60 px-3 py-0.5 text-xs font-semibold text-amber-300"
          data-testid="testnet-chip"
        >
          World Chain Sepolia (4801) — testnet, not real funds
        </span>
      </header>
      {!valid ? (
        <p className="text-sm opacity-80" data-testid="invalid-address">
          That address is not a valid wallet. Check the link.
        </p>
      ) : (
        <>
          <p className="font-mono text-sm tabular-nums opacity-90">{address}</p>
          <div aria-live="polite" data-testid="trail-region">
            <p className="text-sm opacity-70">loading trail from the indexer…</p>
          </div>
        </>
      )}
      <Link href="/" className="text-sm text-[#3ec8ff] underline">
        Open TandaBill
      </Link>
    </main>
  );
}
