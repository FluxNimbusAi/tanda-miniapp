// @vitest-environment jsdom
// C4 page golden: /bill/[address] shell — testnet chip ALWAYS present (UX-3 #7
// law: never implies real funds), invalid address gets honest copy, valid
// address renders mono tabular trail region. Data load is client-side by
// design; shell must be honest without it.
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BillProfile from "../page";

afterEach(cleanup);

const A = "0x1111111111111111111111111111111111111111";

describe("/bill/[address] shell (C4)", () => {
  it("valid address: chip + address + trail region", async () => {
    const ui = await BillProfile({ params: Promise.resolve({ address: A }) });
    render(ui as never);
    expect(screen.getByTestId("testnet-chip").textContent).toContain("not real funds");
    expect(screen.getByTestId("bill-profile").textContent).toContain(A);
    expect(screen.getByTestId("trail-region")).toBeTruthy();
  });
  it("invalid address: honest error copy, no fabricated trail", async () => {
    const ui = await BillProfile({ params: Promise.resolve({ address: "0xnope" }) });
    render(ui as never);
    expect(screen.getByTestId("invalid-address").textContent).toContain("not a valid wallet");
    expect(screen.queryByTestId("trail-region")).toBeNull();
  });
});
