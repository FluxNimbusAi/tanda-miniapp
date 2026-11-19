// M4-2 issue #19 SR-RV-A1: /api/settlements proxy tests. Zero network:
// global fetch is stubbed; we pin (a) 400 rejection BEFORE any upstream call,
// (b) exact upstream URL shape incl. default page=1 and page passthrough,
// (c) byte-passthrough of the indexer payload, (d) upstream 400 forwarding,
// (e) empty-bill [] rows at 200, (f) indexer-down degradation to [] rows
// (200, indexed:false) — never an error state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type FeedBody = {
  bill?: string;
  page?: number;
  page_size?: number;
  total_settlements?: number;
  total_events?: number;
  settlements?: unknown[];
  events?: unknown[];
  indexed?: boolean;
  ok?: boolean;
  error?: string;
  note?: string;
};

const BILL = '0xaabbccddeeff00112233445566778899aabbccd0';
const IDX = 'http://idx.test';

async function getRoute(query: string): Promise<{ status: number; body: FeedBody }> {
  process.env.BILL_INDEX_URL = IDX;
  vi.resetModules();
  const { GET } = await import('../route');
  const req = { nextUrl: new URL(`http://localhost/api/settlements${query}`) } as unknown as NextRequest;
  const res = (await GET(req)) as unknown as Response;
  return { status: res.status, body: (await res.json()) as FeedBody };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(JSON.stringify({ ok: true, echoed: url }), { status: 200 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/settlements validation (no upstream touch)', () => {
  it('rejects malformed bill with 400', async () => {
    for (const q of ['', '?bill=', '?bill=nothex', '?bill=0x123', '?bill=' + BILL.slice(2)]) {
      const r = await getRoute(q);
      expect(r.status, q).toBe(400);
      expect(r.body.error).toContain('0x + 40 hex');
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('rejects malformed page with 400', async () => {
    for (const p of ['0', '-1', 'abc', '1.5', '']) {
      const r = await getRoute(`?bill=${BILL}&page=${p}`);
      expect(r.status, p).toBe(400);
      expect(r.body.error).toContain('integer');
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('GET /api/settlements proxy', () => {
  it('builds canonical indexer URL (default page=1, passthrough otherwise)', async () => {
    const r = await getRoute(`?bill=${BILL.toUpperCase()}`);
    expect(r.status).toBe(200);
    let u = vi.mocked(fetch).mock.calls.at(-1)![0] as string;
    expect(u).toBe(`${IDX}/api/settlements?bill=${BILL}&page=1`);
    await getRoute(`?bill=${BILL}&page=7`);
    u = vi.mocked(fetch).mock.calls.at(-1)![0] as string;
    expect(u).toBe(`${IDX}/api/settlements?bill=${BILL}&page=7`);
  });
  it('passes indexer payload through byte-shape, incl. forwarded 400 and empty []', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () =>
      new Response(JSON.stringify({ bill: BILL, page: 2, page_size: 20, total_settlements: 0, total_events: 0, settlements: [], events: [] }), { status: 200 }),
    );
    const r = await getRoute(`?bill=${BILL}&page=2`);
    expect([r.status, r.body.settlements, r.body.events, r.body.total_events]).toEqual([200, [], [], 0]);
    vi.mocked(fetch).mockImplementationOnce(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const f = await getRoute(`?bill=${BILL}`);
    expect(f.body.ok).toBe(true); // shape preserved, not re-wrapped
    vi.mocked(fetch).mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'bad bill' }), { status: 400 }),
    );
    const e = await getRoute(`?bill=${BILL}`);
    expect(e.status).toBe(400);
  });
  it('degrades to [] rows (200) when indexer is unreachable', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    const r = await getRoute(`?bill=${BILL}`);
    expect(r.status).toBe(200);
    expect(r.body.settlements).toEqual([]);
    expect(r.body.events).toEqual([]);
    expect(r.body.indexed).toBe(false);
    expect(r.body.note).toContain('indexer unavailable');
  });
});
