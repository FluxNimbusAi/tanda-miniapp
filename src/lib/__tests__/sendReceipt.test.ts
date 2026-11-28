// @vitest-environment node
// APP-3 (t_147cd41a) dispatcher golden: permission gate is READ-ONLY
// (never prompts — no-nag law), everything degrades fail-soft, dedup is
// honest, and every real dispatch pairs with the receipt funnel track.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPermissions } = vi.hoisted(() => ({ getPermissions: vi.fn() }));
vi.mock("@worldcoin/minikit-js", () => ({
  MiniKit: { getPermissions },
}));

import { maybeSendReceipt } from "../sendReceipt";

const WALLET = "0xabc0000000000000000000000000000000000123";
const HASH = `0x${"b2".repeat(32)}`;
const CTX = { wallet: WALLET, userOpHash: HASH, usdc: "5.00" };
const GRANTED = { data: { status: 'success', permissions: { notifications: true } } };
const DENIED = { data: { status: 'success', permissions: { notifications: false } } };

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];

const stub = (notify: () => Promise<Response>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : {} });
      if (u.includes("/api/track")) return Response.json({ ok: true }, { status: 202 });
      return notify();
    }),
  );
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = [];
  getPermissions.mockReset();
  getPermissions.mockResolvedValue(GRANTED);
});
afterEach(() => vi.unstubAllGlobals());

describe("maybeSendReceipt", () => {
  it("granted + ok:true → 'sent'; payload is the built receipt; funnel tracked", async () => {
    stub(async () => Response.json({ ok: true }));
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("sent");
    await flush();
    const notify = calls.find((c) => c.url.includes("/api/notify"))!;
    expect(notify.body.wallet_addresses).toEqual([WALLET]);
    expect(notify.body.idempotency_key).toBe(`rcpt:claimSettlement:${HASH}`);
    expect(notify.body.mini_app_path).toBe("/home");
    const track = calls.find((c) => c.url.includes("/api/track"))!;
    expect(track.body).toEqual({ kind: "notify_sent", source: "receipt" });
  });

  it("deduped replay → 'deduped' (honest outcome, double-fire harmless)", async () => {
    stub(async () => Response.json({ ok: true, deduped: true }));
    expect(await maybeSendReceipt("executeSettlement", CTX)).toBe("deduped");
  });

  it("permission NOT granted → 'skipped', zero /api/notify calls, zero prompts", async () => {
    getPermissions.mockResolvedValue(DENIED);
    stub(async () => Response.json({ ok: true }));
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("skipped");
    expect(calls.filter((c) => c.url.includes("/api/notify"))).toHaveLength(0);
    // read-only probe: exactly ONE getPermissions() check, and the mock
    // surface deliberately has NO requestPermission — had this lane tried to
    // prompt, it would have thrown TypeError instead of skipping silently.
    expect(getPermissions).toHaveBeenCalledTimes(1);
  });

  it("outside World App (getPermissions throws) → 'skipped' in silence", async () => {
    getPermissions.mockRejectedValue(new Error("no bridge"));
    stub(async () => Response.json({ ok: true }));
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("fail-closed anchors → 'skipped' BEFORE the permission probe", async () => {
    stub(async () => Response.json({ ok: true }));
    expect(
      await maybeSendReceipt("claimSettlement", { ...CTX, wallet: "0xbad" }),
    ).toBe("skipped");
    expect(getPermissions).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("notify route 500 / ok:false → 'failed', no track, no throw", async () => {
    stub(async () => Response.json({ ok: false, error: "boom" }, { status: 500 }));
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("failed");
    await flush();
    expect(calls.filter((c) => c.url.includes("/api/track"))).toHaveLength(0);
  });

  it("notify fetch throw → 'failed' (fire-and-forget doctrine)", async () => {
    stub(async () => {
      throw new Error("network down");
    });
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("failed");
  });

  it("track analytics failure never corrupts the receipt outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/api/track")
          ? Promise.reject(new Error("index down"))
          : Response.json({ ok: true }),
      ),
    );
    expect(await maybeSendReceipt("claimSettlement", CTX)).toBe("sent");
    await flush();
  });
});
