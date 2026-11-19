// W2.5-4 (t_edd4a5e9) — deep-link landing route: the invite path
// https://world.org/mini-app?app_id=…&path=/bill/{address} opens the webview
// at /bill/{address} inside World App, so this route must exist. It renders
// the SAME TandaBill shell with the bill pre-probed (read-only auto-probe;
// every write still requires the normal in-app gates). No new state machine
// surface: the component is unchanged apart from the optional initialBill.
import { auth } from "@/auth";
import { Page } from "@/components/PageLayout";
import { TandaBill } from "@/components/TandaBill";
import { Marble, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { isAddress, type Address } from "viem";

export default async function BillDeepLinkPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  // World App may hand the path through pre- or post-decoding; accept both.
  let raw = address;
  try {
    raw = decodeURIComponent(address);
  } catch {
    /* already decoded */
  }
  const bill: Address | null = isAddress(raw) ? (raw as Address) : null;
  const session = await auth();

  return (
    <>
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
        {bill ? (
          <TandaBill initialBill={bill} />
        ) : (
          <p className="text-sm opacity-70" data-testid="bill-deeplink-invalid">
            That invite link is malformed — ask the bill owner for a fresh one.
          </p>
        )}
      </Page.Main>
    </>
  );
}
