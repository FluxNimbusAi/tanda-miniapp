// ENGINE-52 (t_8e034a78) — the W2.5-4 invite shell FOLDED INTO the C4 public
// page. History: the shell lived in (protected)/bill/[address]/page.tsx
// (d44ada2), was zeroed by the 1dbcebf Data-API amputation, and Flux ruling
// 57876 (PR #57) keeps the protected route deleted — the single PUBLIC page
// owns /bill/[address]. So the invite path
// https://world.org/mini-app?app_id=…&path=/bill/{address} must again open the
// FULL TandaBill shell with the read-only auto-probe (initialBill), while
// every C4 law (PR #56) holds on the same path:
//   - public page, NO auth wall: session chrome is OPTIONAL (null-safe like
//     the #52 root-layout session-budget discipline — signed-out users get
//     the same trail + shell, minus the name/marble adornment);
//   - testnet chip on EVERY render (UX-3 #7: this page NEVER implies real
//     funds);
//   - generateMetadata + ADDRESS_RE validation + honest empty state.
// W2.5-4 parse pattern preserved: World App may hand the path through pre- or
// post-decoding — accept both; malformed escapes fall back to the raw value.
// No new state-machine surface: the component is unchanged apart from the
// optional initialBill it already accepts (TandaBill/index.tsx auto-probe
// lane, L380-381/L507-513).
import { auth } from "@/auth";
import Link from "next/link";
import type { Metadata } from "next";
import { Page } from "@/components/PageLayout";
import { TandaBill } from "@/components/TandaBill";
import { SettlementTimeline } from "@/components/SettlementTimeline";
import { Marble, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { isAddress, type Address } from "viem";
import { REQ_AMT_RE, REQ_WHO_RE } from "@/lib/inviteLink";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function generateMetadata(): Metadata {
  return {
    title: "Tanda — bill invite & public settlement trail",
    description:
      "Open an invited bill in the Tanda shell or read one wallet's on-chain settlement history. Testnet data; not real funds.",
  };
}

export default async function BillProfile({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ amt?: string; who?: string }>;
}) {
  const { address } = await params;
  // KAIZEN-1 landing half: read + re-validate the display-only hints (the
  // builder validated them once; the page NEVER trusts a hand-typed URL).
  const sp = await searchParams;
  const amtHint = sp.amt && REQ_AMT_RE.test(sp.amt) ? sp.amt : null;
  const whoHint = sp.who && REQ_WHO_RE.test(sp.who) ? sp.who : null;
  // World App may hand the path through pre- or post-decoding; accept both.
  let raw = address;
  try {
    raw = decodeURIComponent(address);
  } catch {
    /* already decoded (or malformed escapes — fall through to the raw value) */
  }
  const valid = ADDRESS_RE.test(raw);
  // viem strict EIP-55 gate (W2.5-4): shaped-but-mixed-case junk keeps the
  // honest trail but never mounts a fabricated shell probe.
  const bill: Address | null =
    valid && isAddress(raw) ? (raw as Address) : null;
  // Session is an enhancement, never a gate (public page — signed-out renders
  // the identical trail + shell). auth() failing open is acceptable: the
  // chrome simply stays hidden.
  const session = await auth().catch(() => null);

  return (
    <Page>
      <Page.Header className="p-0">
        <TopBar
          title="Bill invite"
          endAdornment={
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold capitalize">
                {session?.user.username}
              </p>
              <Marble src={session?.user.profilePictureUrl} className="w-12" />
            </div>
          }
        />
      </Page.Header>
      <Page.Main className="flex flex-col items-center justify-start gap-4 mb-16">
        <div className="grid w-full max-w-xl gap-4" data-testid="bill-profile">
          <header className="flex flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
              Tanda
            </p>
            <h1 className="text-xl font-semibold">
              Bill invite &amp; public settlement trail
            </h1>
            <span
              className="w-fit rounded-full border border-amber-400/60 px-3 py-0.5 text-xs font-semibold text-amber-300"
              data-testid="testnet-chip"
            >
              World Chain Sepolia (4801) — testnet, not real funds
            </span>
          </header>
      {(amtHint || whoHint) && (
        <p className="text-sm opacity-90" data-testid="req-link-hint">
          {whoHint ? <>invited by <span className="font-semibold">{whoHint}</span>{amtHint ? " · " : ""}</> : null}
          {amtHint ? <>your seat is roughly <span className="font-mono tabular-nums">{amtHint} USDC</span> — </> : null}
          the contract&apos;s own figures at join time are the only authority.
        </p>
      )}
          {!valid ? (
            <p className="text-sm opacity-80" data-testid="invalid-address">
              That address is not a valid wallet. Check the link.
            </p>
          ) : (
            <>
              <p className="font-mono text-sm tabular-nums opacity-90">
                {raw}
              </p>
              <div aria-live="polite" data-testid="trail-region">
                <p className="text-sm opacity-70">
                  loading trail from the indexer…
                </p>
              </div>
              {bill ? (
                <>
                  {/* W2.5-4: invite landing = full shell, read-only auto-probe;
                      every write still requires the normal in-app gates. */}
                  <TandaBill initialBill={bill} />
                  {/* ui-t1 P2: lifecycle timeline - pure function of indexer reads */}
                  <SettlementTimeline bill={bill} />
                </>
              ) : (
                <p
                  className="text-sm opacity-70"
                  data-testid="bill-deeplink-invalid"
                >
                  That invite link is malformed — ask the bill owner for a
                  fresh one.
                </p>
              )}
            </>
          )}
          <Link href="/" className="text-sm text-[#3ec8ff] underline">
            Open TandaBill
          </Link>
        </div>
      </Page.Main>
    </Page>
  );
}
