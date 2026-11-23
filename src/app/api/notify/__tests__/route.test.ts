// P1.1b wiring lane (t_p11b_nudge_render): the engine ↔ /api/notify seam
// contract, driven through the REAL route handler with a stubbed upstream.
// The cadence-nudge engine (tanda services/nudge_engine.py notify_payload,
// pinned by its --self-test) sends a ROOT-RELATIVE mini_app_path ("/home")
// and treats only `200 + {ok:true|deduped:true}` as sent. Before this lane
// both facts broke the seam: bare paths were 400'd and successful sends
// (World's {status:"success"} schema, no `ok` field) were passed through
// verbatim — every nudge dead-lettered after 3 retries. These tests pin the
// fixed contract so neither leg can silently regress.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// route.ts statically imports @/auth (next-auth), whose module-load chain
// ('next-auth/lib/env.js' -> 'next/server') cannot resolve inside the vitest
// worker — this suite failed at COLLECT time with ERR_MODULE_NOT_FOUND until
// the leg was mocked (vi.mock is hoisted above imports). The dispatcher's
// auth gate is "internal bearer OR session"; pinning the session leg to
// "no session" keeps every bearer/401 expectation honest while making
// collection deterministic on every runner and OS. The app itself still
// builds against the real auth module (CI `npm run build` covers that leg).
vi.mock('@/auth', () => ({ auth: async () => null }));

import { POST } from '../route';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const APP_ID = 'app_test_seam';
// Runtime-generated so nothing secret-shaped is ever committed.
const INTERNAL = `itest-${process.pid}-${Date.now()}`;

type UpstreamCall = { url: string; body: Record<string, unknown> };
let calls: UpstreamCall[] = [];
let upstreamStatus = 200;
let upstreamJson: unknown = { status: 'success', app_id: APP_ID };

function makeReq(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('http://localhost/api/notify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Verbatim shape of nudge_engine.py::notify_payload output (L433-443). */
function enginePayload(over: Record<string, unknown> = {}) {
  return {
    wallet_addresses: [W1, W2],
    localisations: [
      {
        language: 'en',
        title: "You're 1 of 3 holding up Team dinner — tap to confirm",
        message: 'Settlement expires in 52h — confirm now or escrow auto-refunds',
      },
    ],
    mini_app_path: '/home',
    idempotency_key: `n2b:0xabc0:0:${W1}:${Date.now()}:${Math.random()}`,
    ...over,
  };
}

async function post(body: unknown, bearer = INTERNAL) {
  const res = await POST(makeReq(body, bearer));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  calls = [];
  upstreamStatus = 200;
  upstreamJson = { status: 'success', app_id: APP_ID };
  process.env.MINIKIT_APP_ID = APP_ID;
  process.env.MINIKIT_API_KEY = `mk-test-${process.pid}`;
  process.env.NOTIFY_INTERNAL_KEY = INTERNAL;
  delete process.env.NEXT_PUBLIC_APP_ID;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: unknown) => {
      const opts = init as { body: string };
      calls.push({ url: String(url), body: JSON.parse(opts.body) as Record<string, unknown> });
      return Response.json(upstreamJson, { status: upstreamStatus });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('engine → dispatcher: mini_app_path seam (fix #1)', () => {
  it('root-relative "/home" resolves to the canonical worldapp:// deep link', async () => {
    const { status, json } = await post(enginePayload());
    expect(status).toBe(200);
    expect(json.ok).toBe(true); // engine L584 success test
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://developer.worldcoin.org/api/v2/minikit/send-notification');
    expect(calls[0].body.mini_app_path).toBe(
      `worldapp://mini-app?app_id=${APP_ID}&path=/home`,
    );
    expect(calls[0].body.app_id).toBe(APP_ID);
    expect(calls[0].body.wallet_addresses).toEqual([W1, W2]);
  });

  it('full worldapp:// links from in-app callers pass through untouched', async () => {
    const deep = 'worldapp://mini-app?app_id=someoneelse&path=/history';
    await post(enginePayload({ mini_app_path: deep }));
    expect(calls[0].body.mini_app_path).toBe(deep);
  });

  it('protocol-relative, schemeless, and javascript: paths are still 400', async () => {
    for (const p of ['//evil.example/x', 'home', 'javascript:alert(1)']) {
      const { status, json } = await post(enginePayload({ mini_app_path: p }));
      expect(status, p).toBe(400);
      expect(json.ok).toBe(false);
    }
    expect(calls).toHaveLength(0); // nothing smuggled upstream
  });

  it('omitted path still falls back to /home deep link (pre-existing behavior)', async () => {
    const noPath: Record<string, unknown> = { ...enginePayload() };
    delete noPath.mini_app_path; // no unused-var destructuring (next build lint)
    await post(noPath);
    expect(calls[0].body.mini_app_path).toBe(
      `worldapp://mini-app?app_id=${APP_ID}&path=/home`,
    );
  });
});

describe('engine → dispatcher: response contract (fix #2)', () => {
  it('2xx upstream merges ok:true while keeping World fields for in-app callers', async () => {
    upstreamJson = { status: 'success', app_id: APP_ID, result: { total_sent: 2 } };
    const { status, json } = await post(enginePayload());
    expect(status).toBe(200);
    expect(json).toEqual({
      status: 'success',
      app_id: APP_ID,
      result: { total_sent: 2 },
      ok: true,
    });
  });

  it('non-2xx upstream stays verbatim — no ok, engine keeps rows queued', async () => {
    upstreamStatus = 502;
    upstreamJson = { status: 'error', detail: 'upstream flaked' };
    const { status, json } = await post(enginePayload());
    expect(status).toBe(502);
    expect(json.ok).toBeUndefined();
  });

  it('idempotent replay short-circuits with {ok:true,deduped:true}, zero upstream calls', async () => {
    const key = 'n2b:replay:0:' + Date.now();
    const a = await post(enginePayload({ idempotency_key: key }));
    const b = await post(enginePayload({ idempotency_key: key }));
    expect(a.json.ok).toBe(true);
    expect(b.json).toEqual({ ok: true, deduped: true });
    expect(calls).toHaveLength(1);
  });

  it('duplicate wallets collapse before egress (route dedup, spec §4)', async () => {
    await post(enginePayload({ wallet_addresses: [W1, W1, W2] }));
    expect(calls[0].body.wallet_addresses).toEqual([W1, W2]);
  });
});

describe('dispatcher auth + config gates (engine retry semantics)', () => {
  it('no bearer + no session → 401 unauthorized (never reaches upstream)', async () => {
    // NOTE: post(body, undefined) would silently apply the INTERNAL default
    // (JS default-parameter semantics) — go through makeReq with no bearer so
    // the request truly carries no authorization header.
    const res = await POST(makeReq(enginePayload()));
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
    expect(calls).toHaveLength(0);
  });

  it('wrong bearer → 401 too', async () => {
    const { status } = await post(enginePayload(), 'not-the-key');
    expect(status).toBe(401);
  });

  it('missing MINIKIT_API_KEY → 501 not-configured (engine treats as retryable)', async () => {
    delete process.env.MINIKIT_API_KEY;
    const { status, json } = await post(enginePayload());
    expect(status).toBe(501);
    expect(String(json.error)).toContain('not configured');
    expect(calls).toHaveLength(0);
  });

  it('over-long title (>72) rejected before egress — engine truncates, route enforces', async () => {
    const bad = enginePayload();
    (bad.localisations as Array<{ title: string }>)[0].title = 'x'.repeat(73);
    const { status } = await post(bad);
    expect(status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
