import Link from "next/link";

// COMPLIANCE surface #2 (World review §User Support + §Legal). Terms kept
// short and true: what the contract does, what it does not promise. The
// R1 network-status sentence (Flux ruling 2026-11-27) appears verbatim.
export const metadata = {
  title: "Tanda — Terms",
  description: "The rules the contract enforces, in plain words.",
};

export default function Terms() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-10 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Terms</h1>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
        TandaBill is a production app deployed on World Chain testnet (chain
        4801) with mainnet GA planned; testnet transactions carry no real
        funds.
      </p>
      <section>
        <h2 className="mb-1 font-semibold">What Tanda does</h2>
        <p className="opacity-90">
          Every seat in a bill is one verified human (World ID). Money enters
          escrow at the contract, and each payout is a pull-claim the
          recipient executes. No custody, no fees taken by us, no admin
          override of escrow.
        </p>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">What you accept</h2>
        <ul className="list-disc pl-5 opacity-90">
          <li>
            On-chain settlement is final once executed; disputes before
            execution follow the bill&apos;s confirm window.
          </li>
          <li>
            Testnet balances are not money. Mainnet GA terms will be
            published before any real-funds launch.
          </li>
          <li>
            You are responsible for the accuracy of bills you create.
          </li>
        </ul>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Contact</h2>
        <p className="opacity-90">
          Support and data requests:{" "}
          <a
            className="text-[#3ec8ff] underline"
            href="mailto:tandabill-support@agentmail.to"
          >
            tandabill-support@agentmail.to
          </a>
          . We answer in the order received.
        </p>
      </section>
      <div className="flex gap-4">
        <Link href="/privacy" className="text-[#3ec8ff] underline">
          Privacy
        </Link>
        <Link href="/" className="text-[#3ec8ff] underline">
          Back to Tanda
        </Link>
      </div>
    </main>
  );
}
