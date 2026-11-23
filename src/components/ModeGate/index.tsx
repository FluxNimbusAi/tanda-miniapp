'use client';
// W2.5-3 dual-mode gate. useMiniKit().isInstalled is the live view of
// MiniKit.isInstalled() that MiniKitProvider resolves on mount; until it
// resolves (SSR + first paint) the gate renders the browser lane, so the
// public route never flashes the wallet wall. Full-app lane is byte-identical
// to the old landing hero (W2.5-3 moved it here; nothing else changed).
import { Page } from '@/components/PageLayout';
import { AuthButton } from '@/components/AuthButton';
import { LiveExplorer } from '@/components/Explorer';
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider';

export const ModeGate = () => {
  const { isInstalled } = useMiniKit();

  if (isInstalled === true) {
    return (
      <Page>
        <Page.Main className="flex flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold">Funded means funded.</h1>
            <p className="text-sm opacity-70">
              USDC sits in escrow from day one. When everyone confirms, money
              moves — nobody can ghost your payout.
            </p>
          </div>
          <AuthButton />
        </Page.Main>
      </Page>
    );
  }

  return <LiveExplorer />;
};
