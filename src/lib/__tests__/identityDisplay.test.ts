// KAIZEN-9 (t_5dbc6910) — display-law goldens for the pure helper. Node env
// (default vitest lane): identityDisplay imports nothing, no DOM needed.
import { describe, expect, it } from "vitest";
import {
  identityLabel,
  labelFor,
  namesFromSeats,
  shortAddress,
} from "../identityDisplay";

// A wallet WITH hex letters, so EIP-55 checksum-case drift is representable
// (an all-digit wallet has no case variants — fixture bug from draft one,
// pinned away here).
const W1 = "0x1234567890abcdef1234567890ABCDEF12345678";
const W1MIXED = "0x1234567890ABCDEF1234567890abcdef12345678";

describe("shortAddress (canonical form)", () => {
  it("pins the 6+ellipsis+4 shape the trail goldens froze", () => {
    expect(shortAddress(W1)).toBe("0x1234…5678");
  });
});

describe("identityLabel — username OVER address", () => {
  it("known username: shows @handle and NO address bytes at all", () => {
    const label = identityLabel(W1, "alice");
    expect(label).toBe("@alice");
    expect(label).not.toContain("0x");
  });
  it("unknown username: canonical short address fallback (never blank)", () => {
    expect(identityLabel(W1)).toBe("0x1234…5678");
    expect(identityLabel(W1, undefined)).toBe("0x1234…5678");
  });
  it("blank/whitespace username counts as unknown (feed-drift guard)", () => {
    expect(identityLabel(W1, "")).toBe("0x1234…5678");
    expect(identityLabel(W1, "   ")).toBe("0x1234…5678");
  });
});

describe("namesFromSeats + labelFor", () => {
  it("keys are lowercased wallets -> checksum-case drift still resolves", () => {
    expect(W1.toLowerCase()).toBe(W1MIXED.toLowerCase());
    const map = namesFromSeats([{ wallet: W1, username: "alice" }]);
    expect(labelFor(map, W1MIXED)).toBe("@alice");
  });
  it("rows without a username are skipped, not mapped to empty", () => {
    const map = namesFromSeats([{ wallet: W1, username: undefined }]);
    expect(map.size).toBe(0);
  });
  it("undefined map fail-softs every wallet to its short address", () => {
    expect(labelFor(undefined, W1)).toBe("0x1234…5678");
  });
});
