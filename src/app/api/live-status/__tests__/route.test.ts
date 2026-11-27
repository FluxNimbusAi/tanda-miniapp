// W2.5-3 /api/live-status proxy contract (browser Explorer status strip):
// (a) health passthrough gains indexed:true, (b) non-200 upstream degrades to
// {indexed:false} at 200, (c) fetch throw degrades the same way. The
// Explorer must never observe an error state. Zero network: fetch stubbed.
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
});
