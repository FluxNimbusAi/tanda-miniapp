// G2G-6 product half: keyed proxy to the indexer track lane. The BROWSER
// sends only {kind, source} (no wallet, no bill needed for opens) — this
// route validates shape, attaches INDEX_WRITE_KEY server-side (verify-proof
// pattern), and forwards. Analytics must NEVER break the app: every failure
// degrades to 202-with-note, never a user-visible error.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set(["open", "action", "notify_sent"]);
const SOURCES = new Set([
  "n1", "n2a", "n2b", "n2c", "n3a", "n3b", "organic", "share", "notify_sent",
]);

export async function POST(req: Request): Promise<Response> {
  let body: { kind?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const kind = body.kind, source = body.source;
  if (typeof kind !== "string" || typeof source !== "string" ||
      !KINDS.has(kind) || !SOURCES.has(source)) {
    return Response.json({ ok: false, error: "kind/source not whitelisted" }, { status: 400 });
  }
  const base = process.env.BILL_INDEX_URL;
  const key = process.env.INDEX_WRITE_KEY;
  if (!base || !key) {
    // dev-lane / unconfigured: honest silence, never a throw
    return Response.json({ ok: true, tracked: false, note: "index lane unconfigured" }, { status: 202 });
  }
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ kind, source }),
      signal: AbortSignal.timeout(4000),
    });
    return Response.json({ ok: true, tracked: r.status === 201 }, { status: 202 });
  } catch {
    return Response.json({ ok: true, tracked: false, note: "track forward failed" }, { status: 202 });
  }
}
