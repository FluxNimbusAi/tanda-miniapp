import Link from "next/link";

// COMPLIANCE (docs.world.org/mini-apps/guidelines/policy §Legal, fetched
// 2026-11-27): "All apps that collect and store data from the user must
// request access and gain approval from the user" + data minimization.
// This page is the required disclosure surface. Content law: every claim
// here is TRUE OF THE CODE — read src/app/api/* before writing a line there.
export const metadata = {
  title: "Tanda — Privacy",
  description: "What Tanda stores, why, and how to get it removed.",
};

export default function Privacy() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-10 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Privacy</h1>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
        TandaBill runs on World Chain testnet (4801); mainnet GA is planned.
        Testnet transactions carry no real funds.
      </p>
      <section>
        <h2 className="mb-1 font-semibold">What we store</h2>
        <ul className="list-disc pl-5 opacity-90">
          <li>
            Your wallet address and World ID username when you sign in — used
            to show your bills. No email, no phone, no device fingerprint.
          </li>
          <li>
            Bill data you create: participants&apos; addresses, amounts, and
            settlement events. These are also visible on-chain, which is the
            point of the product.
          </li>
          <li>
            Notification tokens only if you explicitly enable them
            (in-app consent gate). Disable any time.
          </li>
        </ul>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">What we never do</h2>
        <p className="opacity-90">
          No third-party trackers, no advertising IDs, no sale of data. We
          request the minimum World ID fields needed to prove one-human-one-
          seat; nullifier proofs are verified and not retained beyond the
          settlement record.
        </p>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Your control</h2>
        <p className="opacity-90">
          On-chain entries are immutable by design; the off-chain index
          (read-only views) can be purged for your address on request. Email
          {" "}
          <a
            className="text-[#3ec8ff] underline"
            href="mailto:tandabill-support@agentmail.to"
          >
            tandabill-support@agentmail.to
          </a>{" "}
          with your address and we will confirm removal.
        </p>
      </section>
      <Link href="/" className="text-[#3ec8ff] underline">
        Back to Tanda
      </Link>
    </main>
  );
}
