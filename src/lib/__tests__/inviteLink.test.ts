// W2.5-4 (t_edd4a5e9) — golden pins for the per-bill invite deep link.
// CHECKSUM literals were computed with an INDEPENDENT implementation
// (python eth_utils.to_checksum_address) on 2026-11-19, not viem, so these
// asserts cross-check getAddress() rather than echoing it.
import { describe, expect, it } from "vitest";
import {
  billInvitePath,
  buildBillInviteUrl,
  buildInviteShareText,
  INVITE_SHARE_TITLE,
  shortBill,
  WORLD_APP_ID_RE,
} from "@/lib/inviteLink";
import { PORTAL_APP_ID } from "@/lib/portalAnchors";

const VITALIK_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const VITALIK_EIP55 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
// PORTAL-RECON (ruling 4): input := single-source portal anchor; the golden
// URL below stays a byte-exact LITERAL so any anchor drift fails the suite.
const APP_ID = PORTAL_APP_ID;

describe("inviteLink golden wire", () => {
  it("canonicalizes the landing path to EIP-55", () => {
    expect(billInvitePath(VITALIK_LOWER as `0x${string}`)).toBe(
      `/bill/${VITALIK_EIP55}`,
    );
  });

  it("rejects non-address bill inputs", () => {
    expect(() => billInvitePath("0xdeadbeef" as `0x${string}`)).toThrow(RangeError);
  });

  it("builds the exact universal deep link", () => {
    expect(buildBillInviteUrl(VITALIK_LOWER as `0x${string}`, APP_ID)).toBe(
      "https://world.org/mini-app?app_id=app_e691f66620f3537878f639160a0e31f7" +
        `&path=%2Fbill%2F${VITALIK_EIP55}`,
    );
  });

  it("pins the app_id regex gate", () => {
    expect(WORLD_APP_ID_RE.test(APP_ID)).toBe(true);
    expect(WORLD_APP_ID_RE.test("app_short")).toBe(false);
    expect(WORLD_APP_ID_RE.test("rp_e691f66620f3537878f639160a0e31f7")).toBe(false);
    expect(() =>
      buildBillInviteUrl(VITALIK_LOWER as `0x${string}`, "garbage"),
    ).toThrow(RangeError);
  });

  it("shortBill display form", () => {
    expect(shortBill(VITALIK_EIP55 as `0x${string}`)).toBe("0xd8dA…6045");
  });

  it("invite copy sentences are byte-pinned", () => {
    expect(INVITE_SHARE_TITLE).toBe("Join my Tanda bill");
    // owner handle + escrow amount present
    expect(
      buildInviteShareText(VITALIK_EIP55 as `0x${string}`, {
        ownerUsername: "walters",
        usdc: "12.5",
      }),
    ).toBe(
      "@walters is inviting you to Tanda bill 0xd8dA…6045 (12.5 USDC in escrow). " +
        "Funds sit in escrow from day one — when everyone confirms, money moves. " +
        "Take your seat:",
    );
    // anonymous + no amount (P0.2: market the GUARANTEE, never "split a bill")
    expect(buildInviteShareText(VITALIK_EIP55 as `0x${string}`)).toBe(
      "A friend is inviting you to Tanda bill 0xd8dA…6045. " +
        "Funds sit in escrow from day one — when everyone confirms, money moves. " +
        "Take your seat:",
    );
  });
});
