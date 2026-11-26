// @vitest-environment jsdom
// QUALITY WAVE 1 goldens: the resilience trio renders, is honest-register,
// and never contains forbidden marketing residue.
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RouteError from "../error";
import NotFound from "../not-found";
import Loading from "../loading";

afterEach(cleanup);

describe("quality wave 1 - resilience layer", () => {
  it("error boundary shows honest copy + retry, no panic words", () => {
    render(<RouteError error={new Error("boom") as never} reset={() => {}} />);
    expect(screen.getByTestId("route-error")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    const txt = screen.getByTestId("route-error").textContent ?? "";
    for (const bad of ["oops", "Uh oh", "error 500", "CRITICAL"]) {
      expect(txt.toLowerCase()).not.toContain(bad.toLowerCase());
    }
    expect(txt).toContain("Try again");
    // escrow-truth sentence present (money-state honesty law)
    expect(txt).toContain("contract");
  });

  it("404 routes to explorer, no dead-end copy", () => {
    render(<NotFound />);
    const el = screen.getByTestId("not-found");
    expect(el.textContent).toContain("No bill or page lives here");
    expect(el.querySelector('a[href="/explorer"]')).toBeTruthy();
  });

  it("loading is aria-busy with no false progress claim", () => {
    render(<Loading />);
    const el = screen.getByTestId("route-loading");
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect((el.textContent ?? "").toLowerCase()).not.toContain("complete");
  });
});

describe("quality wave 1 - display formatter law", () => {
  it("trim rule: decimals trim, whole numbers never lose digits", () => {
    const disp = (raw: string) =>
      raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
    expect(disp("12.500000")).toBe("12.5");
    expect(disp("100.000000")).toBe("100");
    expect(disp("100")).toBe("100");
    expect(disp("0.000001")).toBe("0.000001");
    expect(disp("0.000000")).toBe("0");
  });
});
