// W2-F2 rp-signature action-allowlist suite (Harley SR-002 finding F2).
// Env is read request-time inside the route, so plain process.env mutation +
// the real POST handler is enough — no module resets, no HTTP server.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// House solution (copied from notify suite, 11-16): @/auth statically pulls
// next-auth -> 'next/server', unresolvable in vitest node env. Mock to
// auth()=>null — session path is inert here; internal-bearer + 401 goldens
// exercise the gate for real.
vi.mock('@/auth', () => ({ auth: async () => null }));

import { POST } from '../route';
import {
  BILL_RP_ACTIONS,
  getRpDenyStats,
  isBillRpAction,
  resetRpDenyStats,
  resetRpRateLimitForTesting,
  sanitizeActionForLog,
} from '@/lib/rpSignatureGuard';

// Valid secp256k1 scalar (< curve order), 32 bytes. Test-only key.
const TEST_SIGNING_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_RP_ID = 'rp_test_allowlist';

function post(body: BodyInit): Request {
  // C1: route now enforces house auth law (session OR internal bearer).
  // Test lane authenticates as internal; dedicated 401/429 goldens below.
  return new Request('http://localhost/api/rp-signature', {
    method: 'POST',
    body,
    headers: { authorization: 'Bearer test-internal-key' },
  });
}

function json(body: unknown): Request {
  return post(JSON.stringify(body));
}

let warnLines: string[] = [];

beforeEach(() => {
  process.env.RP_SIGNING_KEY = TEST_SIGNING_KEY;
  process.env.RP_ID = TEST_RP_ID;
  process.env.RP_INTERNAL_KEY = 'test-internal-key';
  resetRpRateLimitForTesting();
  resetRpDenyStats();
  warnLines = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnLines.push(args.map(String).join(' '));
  });
});

describe('rp-signature allow PATH (signs exactly the enum)', () => {
  it.each([...BILL_RP_ACTIONS])('200 + well-formed signature for %s', async (action) => {
    const res = await POST(json({ action }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.rp_id).toBe(TEST_RP_ID);
    expect(data.sig).toMatch(/^0x[0-9a-fA-F]{130}$/); // 65 bytes (r|s|v)
    expect(data.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/); // 32 bytes
    expect(typeof data.created_at).toBe('number');
    expect(Number(data.expires_at) - Number(data.created_at)).toBe(300);
    const stats = getRpDenyStats();
    expect(stats.signed).toBe(1);
    expect(stats.denied.offlist_action).toBe(0);
    expect(warnLines).toHaveLength(0); // allow path logs no DENY
  });
});

describe('rp-signature REJECT PATH (4xx + log + count)', () => {
  it('403 for the demo string test-action (the exact oracle abuse in SR-002)', async () => {
    const res = await POST(json({ action: 'test-action' }));
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string; allowed: string[] };
    expect(data.error).toBe('action not allowed');
    expect(data.allowed).toEqual(['bill:confirm', 'bill:execute', 'bill:rotate', 'tanda_bill_settlement']);
    expect(getRpDenyStats().denied.offlist_action).toBe(1);
    expect(getRpDenyStats().signed).toBe(0);
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain('DENY reason=offlist_action action="test-action"');
  });

  it('403 for case-variant + prefix/suffix smuggling (exact match, no normalization)', async () => {
    for (const action of [
      'Bill:Confirm',
      'bill:confirm ',
      ' bill:confirm',
      'bill:confirm;DROP TABLE',
      'bill:executeX',
    ]) {
      const res = await POST(json({ action }));
      expect(res.status, action).toBe(403);
    }
    expect(getRpDenyStats().denied.offlist_action).toBe(5);
  });

  it('400 + count for missing / non-string / empty action', async () => {
    const badBodies: unknown[] = [
      {},
      { action: 42 },
      { action: { nested: true } },
      { action: null },
      { action: '' },
    ];
    for (const body of badBodies) {
      const res = await POST(json(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(getRpDenyStats().denied.missing_or_nonstring_action).toBe(5);
    expect(getRpDenyStats().signed).toBe(0);
    expect(warnLines).toHaveLength(5);
  });

  it('400 + count for unparseable JSON body (old code crashed: unhandled rejection)', async () => {
    const res = await POST(post('this is not json {{{'));
    expect(res.status).toBe(400);
    expect(getRpDenyStats().denied.malformed_body).toBe(1);
    expect(warnLines[0]).toContain('DENY reason=malformed_body');
  });

  it('non-object JSON bodies (string/number/array) are 400, not oracle-passed', async () => {
    for (const raw of ['"bill:confirm"', '42', '[{"action":"bill:confirm"}]']) {
      const res = await POST(post(raw));
      expect(res.status, raw).toBe(400);
    }
  });

  it('500 stays intact when RP_SIGNING_KEY is missing (pre-W2-F2 behavior)', async () => {
    delete process.env.RP_SIGNING_KEY;
    const res = await POST(json({ action: 'bill:confirm' }));
    expect(res.status).toBe(500);
    expect(getRpDenyStats().denied.offlist_action).toBe(0);
  });

  it('counters accumulate across requests', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await POST(json({ action: `evil:${i}` }))).status).toBe(403);
    }
    await POST(json({ action: 'bill:rotate' }));
    const s = getRpDenyStats();
    expect(s.denied.offlist_action).toBe(3);
    expect(s.signed).toBe(1);
    expect(warnLines[2]).toContain('denied_total=3');
  });
});

describe('rp-signature DEFAULT RP (PORTAL-RECON, Flux ruling 4)', () => {
  it('signs with the portal anchor rp_id when RP_ID env is unset', async () => {
    delete process.env.RP_ID;
    const res = await POST(json({ action: 'bill:confirm' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    // Byte pin by design: LITERAL, not the constant — if PORTAL_RP_ID drifts
    // off the portal record this golden must FAIL, not silently follow.
    expect(data.rp_id).toBe('rp_4fbd445435612f67');
  });
});

describe('guard unit behavior', () => {
  it('enum is exactly the four accepted verbs (ACTION-FLIP dual-accept window)', () => {
    expect([...BILL_RP_ACTIONS]).toEqual(['bill:confirm', 'bill:execute', 'bill:rotate', 'tanda_bill_settlement']);
    expect(isBillRpAction('bill:execute')).toBe(true);
    expect(isBillRpAction('bill:settle')).toBe(false);
  });

  it('log sanitizer strips control chars (log injection) and caps length', () => {
    expect(sanitizeActionForLog('bill:confirm\nFAKE LOG LINE')).toBe('bill:confirm?FAKE LOG LINE');
    expect(sanitizeActionForLog('a\u0000b\u001bc\u007fd')).toBe('a?b?c?d');
    expect(sanitizeActionForLog(undefined)).toBe('undefined');
    expect(sanitizeActionForLog(null)).toBe('null');
    expect(sanitizeActionForLog(99)).toBe('99');
    const long = 'x'.repeat(200);
    const out = sanitizeActionForLog(long);
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out).toContain('+120');
    expect(out).not.toContain('\n');
  });
});

// ==== QUALITY WAVE C1/C2 goldens (Flux [COMMAND] 57839) ====
describe('C1 auth gate + limiter', () => {
  it('401 on unauthenticated request carrying a valid action', async () => {
    const res = await POST(
      new Request('http://localhost/api/rp-signature', {
        method: 'POST',
        body: JSON.stringify({ action: 'bill:confirm' }),
      }),
    );
    expect(res.status).toBe(401);
  });
  it('503 fail-closed when RP_INTERNAL_KEY unset', async () => {
    const saved = process.env.RP_INTERNAL_KEY;
    delete process.env.RP_INTERNAL_KEY;
    const res = await POST(json({ action: 'tanda_bill_settlement' }));
    expect(res.status).toBe(503);
    process.env.RP_INTERNAL_KEY = saved;
  });
  it('429 after the 20/min window is spent for one IP', async () => {
    let last = 200;
    for (let i = 0; i < 24; i++) {
      const r = new Request('http://localhost/api/rp-signature', {
        method: 'POST',
        body: JSON.stringify({ action: 'bill:confirm' }),
        headers: { authorization: 'Bearer test-internal-key', 'x-forwarded-for': '203.0.113.9' },
      });
      last = (await POST(r)).status;
    }
    expect(last).toBe(429);
  });
});

describe('C2 voided-anchor coercion', () => {
  it('VOIDED env RP_ID coerces to canonical and warns', async () => {
    const saved = process.env.RP_ID;
    process.env.RP_ID = 'rp_a779c304e4f624ce';
    const res = await POST(json({ action: 'tanda_bill_settlement' }));
    const body = await res.json();
    expect(body.rp_id).toBe('rp_4fbd445435612f67');
    expect(warnLines.some((l) => l.includes('VOIDED'))).toBe(true);
    process.env.RP_ID = saved;
  });
  it('unknown (test) anchors still pass through — blocklist, not allowlist', async () => {
    const res = await POST(json({ action: 'bill:execute' }));
    expect((await res.json()).rp_id).toBe(TEST_RP_ID);
  });
});
