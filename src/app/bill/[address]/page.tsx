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
// KAIZEN-1 (t_2eefc765, finding H1): the invite link now also carries
// ?amount/who/redirect; this page reads them through the fail-closed lane
// (parseInviteParams) and shows a pre-indexer invite banner. A crafted link
// can at worst paint sanitized display text; the redirect is never
// auto-followed — it only retargets the same-origin "Open TandaBill" link.
import { auth } from "@/auth";
import Link from "next/link";
import type { Metadata } from "next";
import { Page } from "@/components/PageLayout";
import { TandaBill } from "@/components/TandaBill";
import { SettlementTimeline } from "@/components/SettlementTimeline";
import { parseInviteParams } from "@/lib/inviteLink";
import { Marble, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { isAddress, type Address } from "viem";

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
  // KAIZEN-1: invite context (amount/who/redirect). OPTIONAL by contract —
  // direct visits carry nothing and render the byte-identical ENGINE-52 page.
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { address } = await params;
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
  // KAIZEN-1 (H1) read lane — untrusted until sanitized (see inviteLink).
  const ctx = parseInviteParams(searchParams ? await searchParams : {});

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
          {!valid ? (
            <p className="text-sm opacity-80" data-testid="invalid-address">
              That address is not a valid wallet. Check the link.
            </p>
          ) : (
            <>
              <p className="font-mono text-sm tabular-nums opacity-90">{raw}</p>
              {ctx.who !== null || ctx.amount !== null ? (
                <p
                  className="text-sm font-semibold rounded border border-sky-400/40 px-3 py-1.5 text-sky-300"
                  data-testid="invite-context"
                >
                  {ctx.who !== null
                    ? `@${ctx.who} invited you`
                    : "You were invited"}
                  {ctx.amount !== null ? ` — ${ctx.amount} USDC in escrow` : ""}{" "}
                  (link preview before indexing — contract state is the source
                  of truth)
                </p>
              ) : null}
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
                  That invite link is malformed — ask the bill owner for a fresh
                  one.
                </p>
              )}
            </>
          )}
          <Link
            href={ctx.redirect ?? "/"}
            data-testid="open-tandabill"
            className="text-sm text-[#3ec8ff] underline"
          >
            Open TandaBill
          </Link>
        </div>
      </Page.Main>
    </Page>
  );
}
