// @vitest-environment jsdom
// COMPLIANCE goldens (World policy §Legal + §User Support; ledger
// GOOD_TO_GREAT_RESEARCH R2/R3/R1). Contract:
//  - /privacy names every stored category + support mailto (removal channel)
//  - /terms carries the R1 status sentence verbatim (Flux ruling 11-27)
//  - NEITHER page may contain forbidden register: demo/beta/trial words
//    (R1 rejection risk) or unverifiable promises ("guaranteed", "risk-free")
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Privacy from "../privacy/page";
import Terms from "../terms/page";

afterEach(cleanup);

describe("compliance pages", () => {
  it("privacy: mailto present, storage categories named", () => {
    render(<Privacy />);
    const a = document.querySelector('a[href^="mailto:"]');
    expect(a?.getAttribute("href")).toContain("tandabill-support@agentmail.to");
    const txt = document.body.textContent ?? "";
    for (const s of ["wallet address", "notification", "world id"]) {
      expect(txt.toLowerCase()).toContain(s);
    }
  });

  it("terms: R1 sentence verbatim, no demo/beta/trial anywhere", () => {
    render(<Terms />);
    const txt = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(txt).toContain(
      "production app deployed on World Chain testnet (chain 4801) with mainnet GA planned",
    );
    for (const bad of ["demo", "beta", "trial", "guaranteed", "risk-free"]) {
      expect(txt.toLowerCase()).not.toContain(bad);
    }
  });

  it("both pages: no exclamation-mark marketing residue", () => {
    render(<Privacy />);
    expect(document.body.textContent).not.toContain("!");
    cleanup();
    render(<Terms />);
    expect(document.body.textContent).not.toContain("!");
  });
});
