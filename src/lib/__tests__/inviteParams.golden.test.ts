// KAIZEN-1 (t_2eefc765, finding H1) goldens — invite deep links carry
// amount/who/redirect in the path query, and the landing read lane is
// fail-closed on untrusted input. Wire forms below are byte LITERALS, not
// echoes of the implementation (repo golden law: pin the wire, catch drift).
import { describe, expect, it } from "vitest";
import {
  AMOUNT_RE,
  billInvitePath,
  buildBillInviteUrl,
  parseInviteParams,
  passWho,
  safeRedirect,
} from "@/lib/inviteLink";
import { PORTAL_APP_ID } from "@/lib/portalAnchors";

const VITALIK_EIP55 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const BILL = VITALIK_EIP55 as `0x${string}`;
// Canonical single-source portal anchor (same discipline as the W2.5-4 pins).
const APP_ID = PORTAL_APP_ID;

describe("KAIZEN-1 invite context — write side", () => {
  it("bare path unchanged when opts omitted or empty (W2.5-4 pins hold)", () => {
    expect(billInvitePath(BILL)).toBe(`/bill/${VITALIK_EIP55}`);
    expect(billInvitePath(BILL, {})).toBe(`/bill/${VITALIK_EIP55}`);
  });

  it("amount/who/redirect ride the path query in FIXED order", () => {
    expect(
      billInvitePath(BILL, {
        amount: "12.5",
        who: "walters",
        redirect: `/bill/${VITALIK_EIP55}`,
      }),
    ).toBe(
      `/bill/${VITALIK_EIP55}?amount=12.5&who=%40walters&redirect=%2Fbill%2F${VITALIK_EIP55}`,
    );
  });

  it("universal link wraps the query-path ONE encoding layer deep", () => {
    // '@walters' -> who=%40walters in the path -> %2540 on the outer wire;
    // the redirect's own slashes arrive as %252F — exactly what World App
    // hands back pre-decoded ONCE to the landing route.
    expect(
      buildBillInviteUrl(BILL, APP_ID, {
        amount: "12.5",
        who: "@walters",
        redirect: `/bill/${VITALIK_EIP55}`,
      }),
    ).toBe(
      "https://world.org/mini-app?app_id=app_d3f03e8bce15b7c4580069bf4ea882c2" +
        "&path=%2Fbill%2F" +
        VITALIK_EIP55 +
        "%3Famount%3D12.5%26who%3D%2540walters%26redirect%3D%252Fbill%252F" +
        VITALIK_EIP55,
    );
  });

  it("garbage context is dropped, never poisoned into the link", () => {
    expect(
      billInvitePath(BILL, {
        amount: "1e9",
        who: "$dmi",
        redirect: "//evil.example",
      }),
    ).toBe(`/bill/${VITALIK_EIP55}`);
  });
});

describe("KAIZEN-1 invite context — read side (fail-closed)", () => {
  it("passWho decodes + strips the leading @ (both wire layers tolerated)", () => {
    expect(passWho("%40walters")).toBe("walters");
    expect(passWho("@walters")).toBe("walters");
    expect(passWho("walters")).toBe("walters");
  });

  it("passWho rejects junk, bounds, and non-strings", () => {
    expect(passWho("")).toBeNull();
    expect(passWho("@")).toBeNull();
    expect(passWho("a".repeat(33))).toBeNull();
    expect(passWho("bad/../name")).toBeNull();
    expect(passWho(undefined)).toBeNull();
    expect(passWho(["walters", "evil"])).toBeNull();
  });

  it("round-trip: built path parses back through Next-style decoded params", () => {
    const path = billInvitePath(BILL, {
      amount: "12.5",
      who: "walters",
      redirect: `/bill/${VITALIK_EIP55}`,
    });
    const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(
      parseInviteParams({
        amount: q.get("amount") ?? undefined,
        who: q.get("who") ?? undefined,
        redirect: q.get("redirect") ?? undefined,
      }),
    ).toEqual({
      who: "walters",
      amount: "12.5",
      redirect: `/bill/${VITALIK_EIP55}`,
    });
  });

  it("craft-link defenses: arrays, open redirects, schemes, length caps", () => {
    expect(safeRedirect("/ok/path")).toBe(true);
    expect(safeRedirect("//evil.example")).toBe(false);
    expect(safeRedirect("javascript:alert(1)")).toBe(false);
    expect(safeRedirect("/a\\b")).toBe(false);
    expect(safeRedirect("x".repeat(201))).toBe(false);
    expect(
      parseInviteParams({
        who: ["a", "b"],
        amount: "99999999999999999",
        redirect: "//evil",
      }),
    ).toEqual({ who: null, amount: null, redirect: null });
  });

  it("AMOUNT_RE gates the wire shape", () => {
    expect(AMOUNT_RE.test("0")).toBe(true);
    expect(AMOUNT_RE.test("12.5000")).toBe(true);
    expect(AMOUNT_RE.test("-3")).toBe(false);
    expect(AMOUNT_RE.test("1e9")).toBe(false);
    expect(AMOUNT_RE.test("12,500")).toBe(false);
    expect(AMOUNT_RE.test("1".repeat(13))).toBe(false);
  });
});
