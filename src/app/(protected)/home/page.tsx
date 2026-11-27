import { auth } from '@/auth';
import { Page } from '@/components/PageLayout';
import { UserInfo } from '@/components/UserInfo';
import { TandaBill } from '@/components/TandaBill';
import { ClaimSweep } from '@/components/ClaimSweep';
import { ViewPermissions } from '@/components/ViewPermissions';
import { NotificationConsent } from '@/components/NotificationConsent';
import { Marble, TopBar } from '@worldcoin/mini-apps-ui-kit-react';

// W2.5-3 (t_14b21fee, review-critical per Harley OPP-001): template residue
// PURGED from the app home - the demo Verify widget (pinned to the dead demo
// action that the PR #14 rp-signature allowlist 403s anyway) and the
// Pay/Transaction widgets that transacted real USDC to the template's demo
// username via MiniKit.getUserByUsername. Pay/ is deleted from the repo;
// Transaction/index.tsx SURVIVES per the W26-FIX CoS dual-preservation
// ruling (it carries landed #28 useUserOpStatus wiring; the demo transfer
// is stripped inside it) but is imported by no shipped page. The product
// path is TandaBill (which carries its own
// SEAT_JOIN_ACTION Verify). Gate: src/app/__tests__/templateResidue.golden.test.ts.
export default async function Home() {
  const session = await auth();

  return (
    <>
      <Page.Header className="p-0">
        <TopBar
          title="Home"
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
        <UserInfo />
        <NotificationConsent />
        <TandaBill />
        <ClaimSweep />
        <ViewPermissions />
      </Page.Main>
    </>
  );
}
