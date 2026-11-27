// @vitest-environment jsdom
// C4 page golden: /bill/[address] shell — testnet chip ALWAYS present (UX-3 #7
// law: never implies real funds), invalid address gets honest copy, valid
// address renders mono tabular trail region. Data load is client-side by
// design; shell must be honest without it.
// ENGINE-52 (t_8e034a78) EXTENSION — goldens extended, never replaced: the
// W2.5-4 invite shell now folds into this same PUBLIC page. Valid checksummed
// addresses must mount TandaBill(initialBill) + SettlementTimeline; shaped
// junk with a broken EIP-55 case gets the malformed-invite copy with no shell
// probe; percent-encoded paths must parse (World App hands the path pre- or
// post-decoded); and a null or throwing session must NEVER wall the page.
// Heavy children are stubbed at the module boundary (repo pattern:
// InvitePanel.test.tsx, notify route tests).
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/components/TandaBill", () => ({
  TandaBill: ({ initialBill }: { initialBill?: string }) => (
    <div data-testid="tandabill-shell" data-bill={initialBill ?? ""} />
  ),
}));
vi.mock("@/components/SettlementTimeline", () => ({
  SettlementTimeline: ({ bill }: { bill: string }) => (
    <div data-testid="settlement-timeline" data-bill={bill} />
  ),
}));
vi.mock("@worldcoin/mini-apps-ui-kit-react", () => ({
  TopBar: ({ title }: { title: string }) => (
    <div data-testid="topbar">{title}</div>
  ),
  Marble: ({ src }: { src?: string }) => (
    <img data-testid="marble" src={src ?? ""} alt="" />
  ),
}));

import { auth } from "@/auth";
import BillProfile from "../page";

afterEach(cleanup);

const A = "0x1111111111111111111111111111111111111111";
// Shaped (0x + 40 hex) but mixed-case with a BROKEN EIP-55 checksum: passes
// ADDRESS_RE, rejected by viem isAddress(strict) — pinned against live viem,
// getAddress of this value is 0xd8da6BF26964Af9d7EeD9E03e53415d37aa96046.
const BAD_CHECKSUM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046";

describe("/bill/[address] shell (C4)", () => {
  it("valid address: chip + address + trail region", async () => {
    const ui = await BillProfile({ params: Promise.resolve({ address: A }), searchParams: Promise.resolve({}) });
    render(ui as never);
    expect(screen.getByTestId("testnet-chip").textContent).toContain("not real funds");
    expect(screen.getByTestId("bill-profile").textContent).toContain(A);
    expect(screen.getByTestId("trail-region")).toBeTruthy();
  });
  it("invalid address: honest error copy, no fabricated trail", async () => {
    const ui = await BillProfile({ params: Promise.resolve({ address: "0xnope" }), searchParams: Promise.resolve({}) });
    render(ui as never);
    expect(screen.getByTestId("invalid-address").textContent).toContain("not a valid wallet");
    expect(screen.queryByTestId("trail-region")).toBeNull();
  });
});

describe("/bill/[address] invite shell (ENGINE-52 fold of W2.5-4)", () => {
  it("valid address: full shell + timeline pre-probed; signed-out never walled", async () => {
    // auth mock returns null (signed-out) — page must render trail AND shell.
    const ui = await BillProfile({ params: Promise.resolve({ address: A }), searchParams: Promise.resolve({}) });
    render(ui as never);
    expect(screen.getByTestId("tandabill-shell").getAttribute("data-bill")).toBe(A);
    expect(screen.getByTestId("settlement-timeline").getAttribute("data-bill")).toBe(A);
    expect(screen.getByTestId("testnet-chip").textContent).toContain("not real funds");
  });
  it("broken checksum: honest trail, malformed-invite copy, NO shell probe", async () => {
    const ui = await BillProfile({
      params: Promise.resolve({ address: BAD_CHECKSUM }),
      searchParams: Promise.resolve({}),
    });
    render(ui as never);
    expect(screen.getByTestId("bill-deeplink-invalid").textContent).toContain("malformed");
    expect(screen.queryByTestId("tandabill-shell")).toBeNull();
    expect(screen.getByTestId("testnet-chip").textContent).toContain("not real funds");
  });
  it("percent-encoded path parses to the shell (decode-tolerant lane)", async () => {
    const ui = await BillProfile({
      params: Promise.resolve({ address: "%30x" + A.slice(2) }),
      searchParams: Promise.resolve({}),
    });
    render(ui as never);
    expect(screen.getByTestId("tandabill-shell").getAttribute("data-bill")).toBe(A);
    expect(screen.getByTestId("bill-profile").textContent).toContain(A);
  });
  it("auth() rejection fails open — chrome hidden, public page intact", async () => {
    vi.mocked(auth).mockRejectedValueOnce(new Error("Missing Secrets"));
    const ui = await BillProfile({ params: Promise.resolve({ address: A }), searchParams: Promise.resolve({}) });
    render(ui as never);
    expect(screen.getByTestId("tandabill-shell")).toBeTruthy();
    expect(screen.getByTestId("trail-region")).toBeTruthy();
  });
});

// KAIZEN-1 landing goldens: hints render ONLY when valid; authority sentence
// always accompanies them; hand-typed garbage never appears.
describe("/bill/[address] request-link hints (KAIZEN-1)", () => {
  const A = "0x1111111111111111111111111111111111111111";
  it("valid amt+who -> hint with contract-authority sentence", async () => {
    const ui = await BillProfile({
      params: Promise.resolve({ address: A }),
      searchParams: Promise.resolve({ amt: "12.5", who: "daniel_b" }),
    });
    render(ui as never);
    const el = screen.getByTestId("req-link-hint");
    expect(el.textContent).toContain("12.5 USDC");
    expect(el.textContent).toContain("daniel_b");
    expect(el.textContent).toContain("only authority");
  });
  it("injection-shaped params dropped entirely (no banner)", async () => {
    const ui = await BillProfile({
      params: Promise.resolve({ address: A }),
      searchParams: Promise.resolve({ amt: "12; rm -rf /", who: "<script>x</script>" }),
    });
    render(ui as never);
    expect(screen.queryByTestId("req-link-hint")).toBeNull();
  });
});
