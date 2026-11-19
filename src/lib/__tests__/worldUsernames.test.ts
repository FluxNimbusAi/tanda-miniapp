// W2.5-4 (t_edd4a5e9) — World username resolution client tests.
// Wire shapes pinned from the LIVE service on 2026-11-19
// (GET /api/v1/walters -> 200 {"username":"walters","address":"0x3370…",
//  "profile_picture_url":…}; POST /api/v1/query {"addresses":[],"usernames":
// [...]} -> 200 subset-only array; lowercase addresses on the wire).
// Checksum literals come from python eth_utils (independent of viem).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupUsernamesForWallets,
  normalizeHandle,
  parseSeatTokens,
  QUERY_CHUNK,
  resolveHandle,
  resolveWalletsForHandles,
  toRecord,
  USERNAME_SERVICE_BASE,
  UsernameServiceError,
} from "@/lib/worldUsernames";

const WALTERS_LOWER = "0x3370a98bfbb789b88e223c0a60d934788faefb82";
const WALTERS_EIP55 = "0x3370a98bfBB789B88E223c0a60D934788FaEfb82";
const VITALIK_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const VITALIK_EIP55 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  });

describe("normalizeHandle", () => {
  it("accepts @ prefix, whitespace, mixed case", () => {
    expect(normalizeHandle("  @Alice ")).toBe("alice");
  });
  it("rejects empty / hyphen edges / doubles / charset / length", () => {
    expect(normalizeHandle("@")).toBeNull();
    expect(normalizeHandle("-bob")).toBeNull();
    expect(normalizeHandle("bob-")).toBeNull();
    expect(normalizeHandle("jo--hn")).toBeNull();
    expect(normalizeHandle("has space")).toBeNull();
    expect(normalizeHandle("x".repeat(31))).toBeNull();
    expect(normalizeHandle("x".repeat(30))).toBe("x".repeat(30));
  });
});

describe("parseSeatTokens", () => {
  it("classifies, checksums, dedupes, and isolates invalid tokens", () => {
    const r = parseSeatTokens(
      `${VITALIK_LOWER}, ${VITALIK_EIP55}, @Walters walters bogus!!`,
    );
    expect(r.addresses).toEqual([VITALIK_EIP55]);
    expect(r.handles).toEqual(["walters"]);
    expect(r.invalid).toEqual(["bogus!!"]);
  });
});

describe("resolveHandle (GET /api/v1/{name})", () => {
  it("re-checksums the wire address defensively", async () => {
    fetchMock.mockResolvedValue(
      json({ username: "alice_rc1", address: WALTERS_LOWER }),
    );
    const rec = await resolveHandle("alice_rc1");
    expect(rec).toEqual({ username: "alice_rc1", address: WALTERS_EIP55 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${USERNAME_SERVICE_BASE}/api/v1/alice_rc1`,
    );
  });

  it("404 -> null (unknown handle), 500 -> typed error", async () => {
    fetchMock.mockResolvedValue(json({}, 404));
    expect(await resolveHandle("ghost_404_a")).toBeNull();
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(resolveHandle("boom_500_a")).rejects.toMatchObject({
      code: "http",
    });
  });

  it("network failure -> code network; shape drift -> null", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(resolveHandle("net_down_a")).rejects.toBeInstanceOf(
      UsernameServiceError,
    );
    fetchMock.mockResolvedValue(json({ username: "noaddr" }));
    expect(await resolveHandle("noaddr_a")).toBeNull();
  });

  it("60s TTL cache collapses repeat lookups into one fetch", async () => {
    fetchMock.mockResolvedValue(json({ username: "cached_a", address: WALTERS_LOWER }));
    await resolveHandle("cached_a");
    await resolveHandle("CACHED_A"); // case-folded key hit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("query batch (POST /api/v1/query)", () => {
  it("handle->wallet batch returns only found subset", async () => {
    fetchMock.mockResolvedValue(
      json([{ username: "findme_a", address: WALTERS_LOWER }]),
    );
    const m = await resolveWalletsForHandles(["findme_a", "missing_a"]);
    expect([...m.keys()]).toEqual(["findme_a"]);
    expect(m.get("findme_a")!.address).toBe(WALTERS_EIP55);
    // byte contract: BOTH keys always present on the wire
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ addresses: [], usernames: ["findme_a", "missing_a"] });
  });

  it("wallet->handle batch dedupes + lowercase-keys; both keys present", async () => {
    fetchMock.mockResolvedValue(
      json([{ username: "v_a", address: VITALIK_LOWER }]),
    );
    const m = await lookupUsernamesForWallets([
      VITALIK_EIP55 as `0x${string}`,
      VITALIK_LOWER as `0x${string}`,
      WALTERS_EIP55 as `0x${string}`,
    ]);
    expect(m.get(VITALIK_LOWER)).toEqual({
      username: "v_a",
      address: VITALIK_EIP55,
    });
    expect(m.has(WALTERS_LOWER)).toBe(false); // subset-only semantics
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.addresses).toEqual([VITALIK_LOWER, WALTERS_LOWER]);
    expect(body.usernames).toEqual([]);
  });

  it("splits batches above QUERY_CHUNK into multiple POSTs", async () => {
    const many = Array.from({ length: QUERY_CHUNK + 5 }, (_, i) => `h_many_${i}`);
    fetchMock.mockResolvedValue(json([]));
    await resolveWalletsForHandles(many);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("422 too-many-items surfaces as a typed http error", async () => {
    fetchMock.mockResolvedValue(json({}, 422));
    await expect(
      resolveWalletsForHandles(["h_422_a"]),
    ).rejects.toThrow(/too many items/);
  });

  it("non-array body -> shape error, never a crash", async () => {
    fetchMock.mockResolvedValue(json({ unexpected: "object" }));
    await expect(resolveWalletsForHandles(["h_shape_a"])).rejects.toMatchObject({
      code: "shape",
    });
  });
});

describe("toRecord defensive parse", () => {
  it("null on missing/invalid fields, passes optional picture through", () => {
    expect(toRecord(null)).toBeNull();
    expect(toRecord({ username: "x", address: "0x123" })).toBeNull();
    expect(
      toRecord({ username: "y", address: WALTERS_LOWER, profile_picture_url: "u" }),
    ).toEqual({
      username: "y",
      address: WALTERS_EIP55,
      profilePictureUrl: "u",
    });
  });
});
