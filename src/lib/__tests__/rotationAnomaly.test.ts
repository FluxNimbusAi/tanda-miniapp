// P0.3 C2 ruling addendum (t_96389deb, Flux 2026-11-17 Option A): every clause
// boundary of the post-confirm-rotation resolver, pinned to the ruling wording.
// BigInt() call form throughout (template target < ES2020, mirrors billActions).
import { describe, it, expect } from 'vitest';
import {
  computePostConfirmRotations,
  type RotationEventLite,
  type RotationFacts,
} from '@/lib/rotationAnomaly';

const facts = (confirmedMask: bigint, fullyConfirmedAt: bigint): RotationFacts => ({
  confirmedMask,
  fullyConfirmedAt,
});
const ev = (seatId: number, blockTimestamp: number): RotationEventLite => ({
  seatId,
  blockTimestamp,
});

const FCA = BigInt(1_000_000);

describe('computePostConfirmRotations - C2 addendum clause boundaries', () => {
  it('flags a confirmed seat that rotated strictly after full confirmation', () => {
    const flagged = computePostConfirmRotations([ev(0, 1_000_001)], facts(BigInt(0b1), FCA));
    expect(flagged).toEqual(new Set([0]));
  });

  it('no anchor (fullyConfirmedAt = 0): nothing is ever flagged, even with mask bits', () => {
    const flagged = computePostConfirmRotations(
      [ev(0, 2_000_000), ev(1, 3_000_000)],
      facts(BigInt(0b11), BigInt(0)),
    );
    expect(flagged.size).toBe(0);
  });

  it('same-block boundary: rotatedAt === fullyConfirmedAt is NOT post-confirm (strict >)', () => {
    const flagged = computePostConfirmRotations([ev(0, 1_000_000)], facts(BigInt(1), FCA));
    expect(flagged.size).toBe(0);
  });

  it('pre-confirm rotation is the legitimate split-lock branch, never an anomaly', () => {
    const flagged = computePostConfirmRotations([ev(0, 999_999)], facts(BigInt(1), FCA));
    expect(flagged.size).toBe(0);
  });

  it('seat outside confirmedMask rotating after FCA: never confirmed, so no flag', () => {
    const flagged = computePostConfirmRotations([ev(2, 1_000_001)], facts(BigInt(0b1010), FCA));
    expect(flagged.size).toBe(0);
  });

  it('mask bits resolve by seat index, not by event order or arrival count', () => {
    const flagged = computePostConfirmRotations(
      [ev(3, 1_000_001), ev(2, 1_000_002), ev(1, 1_000_003), ev(0, 1_000_004)],
      facts(BigInt(0b1010), FCA),
    );
    expect([...flagged].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('multiple rotations: ANY post-confirm event flags; pre-confirm events are inert', () => {
    const flagged = computePostConfirmRotations(
      [ev(1, 500_000), ev(1, 1_000_001), ev(4, 900_000)],
      facts(BigInt(0b11110), FCA),
    );
    expect(flagged).toEqual(new Set([1]));
  });

  it('post-then-pre arrival ordering does not unflag (pure ordering fact)', () => {
    const flagged = computePostConfirmRotations(
      [ev(0, 1_000_001), ev(0, 999_999)],
      facts(BigInt(1), FCA),
    );
    expect(flagged).toEqual(new Set([0]));
  });

  it('high seat indices beyond 32-bit mask arithmetic work', () => {
    const flagged = computePostConfirmRotations(
      [ev(40, 1_000_001)],
      facts(BigInt(1) << BigInt(40), FCA),
    );
    expect(flagged).toEqual(new Set([40]));
  });

  it('malformed log rows skipped defensively; valid rows still resolve', () => {
    const flagged = computePostConfirmRotations(
      [ev(-1, 1_000_001), ev(1.5, 1_000_001), ev(0, NaN), ev(0, Infinity), ev(0, 1_000_001)],
      facts(BigInt(1), FCA),
    );
    expect(flagged).toEqual(new Set([0]));
  });
});
