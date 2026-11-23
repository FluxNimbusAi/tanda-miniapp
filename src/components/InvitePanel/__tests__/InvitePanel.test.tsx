// @vitest-environment jsdom
// W2.5-4 (t_edd4a5e9) — InvitePanel one-tap share lanes.
// MiniKit.share is mocked at the SDK boundary; every non-native route
// (navigator.share, clipboard, failure) is asserted on exact status text.
import { InvitePanel, type ShareRoute } from "@/components/InvitePanel";
import { PORTAL_APP_ID } from "@/lib/portalAnchors";
import "@testing-library/jest-dom/vitest";
import { MiniKit } from "@worldcoin/minikit-js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL auto-cleanup needs vitest globals; this repo runs without them, so
// clean the DOM explicitly or every panel from earlier tests leaks in.
afterEach(cleanup);

vi.mock("@worldcoin/minikit-js", () => ({
  MiniKit: { share: vi.fn() },
}));

vi.mock("@worldcoin/mini-apps-ui-kit-react", () => ({
  Button: ({
    onClick,
    children,
  }: {
    onClick: () => void;
    children: React.ReactNode;
  }) => <button onClick={onClick}>{children}</button>,
}));

const VITALIK_EIP55 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
// PORTAL-RECON (ruling 4): input := single-source portal anchor; GOLDEN_URL
// below stays a byte-exact LITERAL so any anchor drift fails the suite.
const APP_ID = PORTAL_APP_ID;
const GOLDEN_URL =
  "https://world.org/mini-app?app_id=app_e691f66620f3537878f639160a0e31f7" +
  `&path=%2Fbill%2F${VITALIK_EIP55}`;

const shareMock = vi.mocked(MiniKit.share) as unknown as ReturnType<
  typeof vi.fn
>;

const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  shareMock.mockReset();
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  // strip any navigator.share between tests (jsdom has none by default)
  Reflect.deleteProperty(navigator, "share");
});

const panel = () =>
  render(
    <InvitePanel
      bill={VITALIK_EIP55 as `0x${string}`}
      appId={APP_ID}
      ownerUsername="walters"
      usdc="12.5"
    />,
  );

describe("InvitePanel", () => {
  it("renders the golden universal deep link", () => {
    panel();
    expect(screen.getByTestId("invite-url")).toHaveValue(GOLDEN_URL);
  });

  it("degrades cleanly when app_id is unconfigured", () => {
    render(<InvitePanel bill={VITALIK_EIP55 as `0x${string}`} appId="" />);
    expect(screen.getByTestId("invite-unavailable").textContent).toContain(
      "Invite links unavailable",
    );
  });

  it("Copy tap writes the link and confirms", async () => {
    panel();
    fireEvent.click(screen.getByText("Copy link"));
    expect(writeText).toHaveBeenCalledWith(GOLDEN_URL);
    expect(await screen.findByText("Copied ✓")).toBeTruthy();
  });

  it("Copy tap surfaces clipboard-blocked guidance", async () => {
    writeText.mockRejectedValueOnce(new Error("blocked"));
    panel();
    fireEvent.click(screen.getByText("Copy link"));
    expect(
      await screen.findByTestId("invite-status"),
    ).toHaveTextContent("long-press");
  });

  it("Share via World App sheet reports the minikit route", async () => {
    shareMock.mockResolvedValue({
      executedWith: "minikit",
      data: { shared_files_count: 0, timestamp: "t" },
    });
    panel();
    fireEvent.click(screen.getByText("Share invite"));
    expect(await screen.findByTestId("invite-status")).toHaveTextContent(
      "invite shared via World App",
    );
    const opts = shareMock.mock.calls[0][0];
    expect(opts.url).toBe(GOLDEN_URL);
    expect(opts.title).toBe("Join my Tanda bill");
    expect(typeof opts.fallback).toBe("function");
  });

  it("fallback branch (executedWith fallback) reports the web route", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: shareSpy, configurable: true });
    shareMock.mockImplementation(
      async (opts: { fallback?: () => Promise<ShareRoute> }) => {
        const route = await opts.fallback!();
        return { executedWith: "fallback", data: route };
      },
    );
    panel();
    fireEvent.click(screen.getByText("Share invite"));
    expect(await screen.findByTestId("invite-status")).toHaveTextContent(
      "invite shared via system sheet",
    );
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: GOLDEN_URL }),
    );
  });

  it("MiniKit unavailable -> direct web lane with clipboard", async () => {
    shareMock.mockRejectedValue(new Error("CommandUnavailable"));
    panel();
    fireEvent.click(screen.getByText("Share invite"));
    expect(await screen.findByTestId("invite-status")).toHaveTextContent(
      "invite link copied to clipboard",
    );
    expect(writeText).toHaveBeenCalledWith(GOLDEN_URL);
  });

  it("total web failure tells the user to copy manually", async () => {
    shareMock.mockRejectedValue(new Error("no minikit"));
    writeText.mockRejectedValue(new Error("no clipboard"));
    panel();
    fireEvent.click(screen.getByText("Share invite"));
    expect(await screen.findByTestId("invite-status")).toHaveTextContent(
      "share failed — copy the link instead",
    );
  });
});
