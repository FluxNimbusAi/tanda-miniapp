"use client";
// W2.5-3 dual-mode gate. useMiniKit().isInstalled is the live view of
// MiniKit.isInstalled() that MiniKitProvider resolves on mount; until it
// resolves (SSR + first paint) the gate renders the browser lane, so the
// public route never flashes the wallet wall. Full-app lane is byte-identical
// to the old landing hero (W2.5-3 moved it here; nothing else changed).
import { Page } from "@/components/PageLayout";
import { AuthButton } from "@/components/AuthButton";
import { LiveExplorer } from "@/components/Explorer";
import { useMiniKit } from "@worldcoin/minikit-js/minikit-provider";

export const ModeGate = () => {
  const { isInstalled } = useMiniKit();

  if (isInstalled === true) {
    return (
      <Page>
        <Page.Main className="flex flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]">
              TandaBill
            </p>
            <h1
              className="font-semibold"
              style={{
                fontSize: "clamp(1.5rem, 6vw, 2.1rem)",
                lineHeight: 1.15,
              }}
            >
              Funded means funded.
            </h1>
            <p className="text-sm opacity-85">
              USDC sits in escrow from day one. When everyone confirms, money
              moves — nobody can ghost your payout.
            </p>
          </div>
          <AuthButton />
          <footer className="mt-10 flex items-center justify-center gap-4 text-xs opacity-70" data-testid="compliance-links">
            <a href="/privacy" className="underline">Privacy</a>
            <a href="/terms" className="underline">Terms</a>
            <a href="mailto:tandabill-support@agentmail.to" className="underline">Support</a>
          </footer>
        </Page.Main>
      </Page>
    );
  }

  return <LiveExplorer />;
};
