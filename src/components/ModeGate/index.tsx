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

  // APP-1 (t_f16cf60b): null = MiniKit still resolving. Falling through to
  // LiveExplorer here FLASHED the browser mode at World App users for a
  // beat — a splash-first entry is the native-app cue and kills the flash.
  if (isInstalled !== true && isInstalled !== false) {
    return (
      <Page>
        <Page.Main className="flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p
            className="text-xs font-bold uppercase tracking-[0.2em] text-[#3ec8ff]"
            data-testid="app-splash-kicker"
          >
            TandaBill
          </p>
          <p className="font-semibold" style={{ fontSize: "clamp(1.2rem, 5vw, 1.6rem)" }}>
            Funded means funded.
          </p>
        </Page.Main>
      </Page>
    );
  }

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
