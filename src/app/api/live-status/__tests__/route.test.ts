// W2.5-3 /api/live-status proxy contract (browser Explorer status strip):
// (a) health passthrough gains indexed:true + source:'live' + as_of (KAIZEN-8
// stamps every live read), (b) non-200 upstream degrades to {indexed:false}
// at 200, (c) fetch throw degrades the same way, (d) a warm instance holding
// a last-known-good snapshot replays it tagged {source:'cache', stale:true,
// as_of} instead of pretending offline. The Explorer must never observe an
// error state. Zero network: fetch stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Body = Record<string, unknown>;

async function getRoute(): Promise<{ status: number; body: Body }> {
  process.env.BILL_INDEX_URL = 'http://idx.test';
  vi.resetModules();
  const { GET } = await import('../route');
  const res = (await GET()) as unknown as Response;
  return { status: res.status, body: (await res.json()) as Body };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/live-status', () => {
  it('passes the health body through and flags indexed:true on status ok', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        return new Response(
          JSON.stringify({ status: 'ok', chain_id: 4801, bills_indexed: 18 }),
          { status: 200 },
        );
      }),
    );
    const { status, body } = await getRoute();
    expect(status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      chain_id: 4801,
      bills_indexed: 18,
      indexed: true,
      source: 'live',
      as_of: expect.any(Number),
    });
    expect(seen).toEqual(['http://idx.test/health']);
  });

  it('upstream non-200 degrades to indexed:false at 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    const { status, body } = await getRoute();
    expect(status).toBe(200);
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('503');
  });

  it('indexer-down (fetch throw) degrades to indexed:false at 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { status, body } = await getRoute();
    expect(status).toBe(200);
    expect(body.indexed).toBe(false);
    expect(String(body.note)).toContain('indexer unavailable');
  });

  it('warm instance replays last-known-good tagged + timestamped when the indexer dies', async () => {
    process.env.BILL_INDEX_URL = 'http://idx.test';
    vi.resetModules();
    const { GET } = await import('../route');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ status: 'ok', chain_id: 4801, bills_indexed: 18 }),
          { status: 200 },
        ),
      ),
    );
    const live = (await (await GET()).json()) as Body;
    expect(live.indexed).toBe(true);
    expect(live.source).toBe('live');
    // Same module instance; upstream now unreachable.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const res = await GET();
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      chain_id: 4801,
      bills_indexed: 18,
      indexed: false,
      source: 'cache',
      stale: true,
      as_of: live.as_of,
      note: 'indexer unreachable; showing last-known-good',
    });
  });
});
