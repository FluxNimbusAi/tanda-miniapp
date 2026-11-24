import { describe, expect, it } from "vitest";
import { pendingOnChainGrants } from "../seatJoin";

const BILL = "0xD1b746Eee830B7CD0b9117b33C9d1E20B9456358"; // mixed-case: canonicalization subject
const NUL = "0x" + "ab".repeat(32);
const NUL2 = "0x" + "cd".repeat(32);

describe("pendingOnChainGrants (BRIDGE-2 t_a9f67ed4)", () => {
  it("real verified grant, not seated -> pending with canonical lowercase signal", () => {
    const p = pendingOnChainGrants(
      { "0xDEADbeef00000000000000000000000000000001": { nullifier: NUL } },
      [],
      BILL,
    );
    expect(p).toHaveLength(1);
    expect(p[0].wallet).toBe("0xdeadbeef00000000000000000000000000000001");
    expect(p[0].signal).toBe(
      "0xd1b746eee830b7cd0b9117b33c9d1e20b9456358:0xdeadbeef00000000000000000000000000000001",
    );
  });
  it("chain:seat placeholders are EXCLUDED by shape, never trusted", () => {
    expect(
      pendingOnChainGrants(
        {
          "0xdeadbeef00000000000000000000000000000001": {
            nullifier: "chain:seat:0",
          },
        },
        [],
        BILL,
      ),
    ).toEqual([]);
  });
  it("wallet already an ACTIVE on-chain seat -> not pending", () => {
    const grants = {
      "0xdeadbeef00000000000000000000000000000001": { nullifier: NUL },
    };
    expect(
      pendingOnChainGrants(
        grants,
        [
          {
            wallet: "0xDEADBEEF00000000000000000000000000000001",
            active: true,
          },
        ],
        BILL,
      ),
    ).toEqual([]);
  });
  it("removed (inactive) seat with fresh nullifier -> pending again (contract re-grant path)", () => {
    const p = pendingOnChainGrants(
      { "0xdeadbeef00000000000000000000000000000001": { nullifier: NUL2 } },
      [{ wallet: "0xdeadbeef00000000000000000000000000000001", active: false }],
      BILL,
    );
    expect(p).toHaveLength(1);
  });
  it("multi-grant output sorted by wallet (deterministic UI order)", () => {
    const p = pendingOnChainGrants(
      {
        "0x00000000000000000000000000000000000000ff": { nullifier: NUL },
        "0x0000000000000000000000000000000000000002": { nullifier: NUL2 },
      },
      [],
      BILL,
    );
    expect(p.map((x) => x.wallet)).toEqual([
      "0x0000000000000000000000000000000000000002",
      "0x00000000000000000000000000000000000000ff",
    ]);
  });
});
