import { describe, expect, it } from "vitest";
import { maskBits } from "../chainBill";

// UGLY-1 (t_b7c72897) goldens: the mask decoder is the entire trust surface
// of state-synthesized events - bits are exactly what the contract stores.
describe("chainBill.maskBits (Direct Truth mask decode)", () => {
  it("zero mask -> no seats", () => expect(maskBits(BigInt(0))).toEqual([]));
  it("LSB only -> seat 0", () => expect(maskBits(BigInt(1))).toEqual([0]));
  it("0b1010 -> seats 1 and 3", () =>
    expect(maskBits(BigInt(10))).toEqual([1, 3]));
  it("full 4-seat mask", () =>
    expect(maskBits(BigInt(0b1111))).toEqual([0, 1, 2, 3]));
  it("high bit (seat 129) stays precise past Number.MAX_SAFE_INTEGER", () => {
    const m = BigInt(1) << BigInt(129);
    expect(maskBits(m)).toEqual([129]);
  });
  it("MAX_SEATS-wide alternating mask keeps ordering ascending", () => {
    const bits = maskBits((BigInt(1) << BigInt(256)) - BigInt(1));
    expect(bits.length).toBe(256);
    expect(bits[0]).toBe(0);
    expect(bits[255]).toBe(255);
    expect(bits).toEqual([...bits].sort((a, b) => a - b));
  });
});
