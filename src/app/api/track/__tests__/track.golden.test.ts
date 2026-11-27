// @vitest-environment node
// G2G-6 golden: /api/track proxy — validation, key isolation, degrade-silent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const jsonReq = (body: unknown) =>
  new Request("http://localhost/api/track", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  process.env.BILL_INDEX_URL = "http://index.test";
  process.env.INDEX_WRITE_KEY = "wkey";
});
afterEach(() => {
  delete process.env.BILL_INDEX_URL;
  delete process.env.INDEX_WRITE_KEY;
  vi.unstubAllGlobals();
});

describe("/api/track proxy", () => {
  it("400 on non-whitelisted kind/source (flood + free-text guard)", async () => {
    expect((await POST(jsonReq({ kind: "exploit", source: "organic" }))).status).toBe(400);
    expect((await POST(jsonReq({ kind: "open", source: "https://evil" }))).status).toBe(400);
    expect((await POST(jsonReq({}))).status).toBe(400);
  });

  it("forwards with server-side key; response never leaks it", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seen.url = url;
      seen.headers = init.headers;
      return new Response("{}", { status: 201 });
    }));
    const res = await POST(jsonReq({ kind: "open", source: "n2a" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.tracked).toBe(true);
    expect(seen.url).toBe("http://index.test/api/track");
    expect(seen.headers!.Authorization).toBe("Bearer wkey"); // key added HERE, server-side
    expect(JSON.stringify(body)).not.toContain("wkey"); // never echoed back
  });

  it("unconfigured index lane -> honest 202 tracked:false, no throw", async () => {
    delete process.env.BILL_INDEX_URL;
    const res = await POST(jsonReq({ kind: "open", source: "organic" }));
    expect(res.status).toBe(202);
    expect((await res.json()).tracked).toBe(false);
  });

  it("index unreachable -> 202 degrade, analytics never breaks the app", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await POST(jsonReq({ kind: "open", source: "share" }));
    expect(res.status).toBe(202);
    expect((await res.json()).tracked).toBe(false);
  });
});
