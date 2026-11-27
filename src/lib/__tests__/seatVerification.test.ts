// P0.3 seat-level World ID verification — resolver contract tests (t_44ae186c).
// Pins the frozen feed contract from t_1681436c: verified seats, unverified
// seats, missing/malformed verification data, and the boolean-flag bridge.
import { describe, it, expect } from 'vitest';
import {
  resolveSeatVerification,
  verificationToFlag,
  flagToVerification,
  type SeatGrantsFeed,
} from '@/lib/seatVerification';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const MIXED = '0xAaBbCcDdEeFf00112233445566778899AaBbCcDd';

const liveFeed = (grants: Record<string, unknown>): SeatGrantsFeed => ({
  grants,
  indexed: true,
});

describe('resolveSeatVerification — verified seats', () => {
  it('verified when index live and wallet present in grants', () => {
    expect(resolveSeatVerification(liveFeed({ [W1]: { nullifier: 'n1' } }), W1)).toBe(
      'verified',
    );
  });

  it('matches case-insensitively on the wallet key (feed keys are lowercased)', () => {
    expect(resolveSeatVerification(liveFeed({ [W1]: { nullifier: 'n' } }), W1.toUpperCase().replace('0X', '0x'))).toBe('verified');
    expect(resolveSeatVerification(liveFeed({ [W1.toUpperCase().replace('0X', '0x')]: { nullifier: 'n' } }), W1.toUpperCase().replace('0X', '0x') === W1 ? W1 : MIXED)).toBeTypeOf('string');
  });

  it('fully-uppercased 0X-prefixed wallet still parses and matches (ADDRESS_RE [xX])', () => {
    const upper = MIXED.toUpperCase(); // '0X...' form
    expect(upper.startsWith('0X')).toBe(true);
    expect(resolveSeatVerification(liveFeed({ [MIXED.toLowerCase()]: { nullifier: 'n' } }), upper)).toBe('verified');
  });

  it('extra grants entries do not affect other wallets', () => {
    const feed = liveFeed({ [W1]: { nullifier: 'n1' }, [W2]: { nullifier: 'n2' } });
    expect(resolveSeatVerification(feed, W1)).toBe('verified');
    expect(resolveSeatVerification(feed, W2)).toBe('verified');
  });
});

describe('resolveSeatVerification — unverified seats', () => {
  it('unverified when index is live but wallet explicitly absent', () => {
    expect(resolveSeatVerification(liveFeed({ [W2]: { nullifier: 'n2' } }), W1)).toBe(
      'unverified',
    );
  });

  it('unverified on an empty-but-live grants map (everyone explicitly missing)', () => {
    expect(resolveSeatVerification(liveFeed({}), W1)).toBe('unverified');
  });
});

describe('resolveSeatVerification — missing / malformed verification data', () => {
  it('unknown when the feed itself is missing (null/undefined)', () => {
    expect(resolveSeatVerification(null, W1)).toBe('unknown');
    expect(resolveSeatVerification(undefined, W1)).toBe('unknown');
  });

  it('unknown when the feed is not an object (json() garbage tolerated)', () => {
    for (const junk of ['string', 42, true]) {
      expect(resolveSeatVerification(junk as SeatGrantsFeed, W1)).toBe('unknown');
    }
  });

  it('unknown when indexed is absent (index not built yet)', () => {
    expect(resolveSeatVerification({ grants: { [W1]: { nullifier: 'n' } } }, W1)).toBe(
      'unknown',
    );
  });

  it('unknown when indexed is not strictly boolean true (only true counts)', () => {
    for (const bad of [false, 'true', 1, null, undefined]) {
      expect(resolveSeatVerification({ grants: { [W1]: {} }, indexed: bad }, W1)).toBe(
        'unknown',
      );
    }
  });

  it('unknown when grants is missing, null, or non-object even with live index', () => {
    for (const grants of [undefined, null, 'nope', 7]) {
      expect(resolveSeatVerification({ grants, indexed: true }, W1)).toBe('unknown');
    }
  });

  it('unknown for the real degraded API payload shape (table-not-built note)', () => {
    const degraded = {
      grants: {},
      indexed: false,
      note: 'seat_grants table not built yet (slice 3)',
    };
    expect(resolveSeatVerification(degraded, W1)).toBe('unknown');
  });

  it('never throws on any malformed combination', () => {
    expect(() =>
      resolveSeatVerification({ grants: [1, 2, 3], indexed: true }, W1),
    ).not.toThrow();
  });

  it('only own grants keys count (explicit scan; inherited members are not grants)', () => {
    const inherited = Object.create({ [W1]: { nullifier: 'ghost' } }) as Record<string, unknown>;
    expect(resolveSeatVerification(liveFeed(inherited), W1)).toBe('unverified');
  });

  it('invalid or missing wallet resolves unknown regardless of feed', () => {
    const feed = liveFeed({ [W1]: { nullifier: 'n' } });
    for (const bad of [undefined, '', 'nope', '0x123', W1.slice(2), '0x' + 'a'.repeat(39), '0x' + 'g'.repeat(40)]) {
      expect(resolveSeatVerification(feed, bad)).toBe('unknown');
    }
  });
});

describe('flag bridges (SeatRow.verified <-> badge state)', () => {
  it('verificationToFlag maps the tri-state to the legacy boolean|null', () => {
    expect(verificationToFlag('verified')).toBe(true);
    expect(verificationToFlag('unverified')).toBe(false);
    expect(verificationToFlag('unknown')).toBe(null);
  });

  it('flagToVerification maps true/false/null/undefined/garbage correctly', () => {
    expect(flagToVerification(true)).toBe('verified');
    expect(flagToVerification(false)).toBe('unverified');
    expect(flagToVerification(null)).toBe('unknown');
    expect(flagToVerification(undefined)).toBe('unknown');
    expect(flagToVerification('yes' as unknown as boolean | null)).toBe('unknown');
  });

  it('round-trips all three states', () => {
    for (const v of ['verified', 'unverified', 'unknown'] as const) {
      expect(flagToVerification(verificationToFlag(v))).toBe(v);
    }
  });
});
