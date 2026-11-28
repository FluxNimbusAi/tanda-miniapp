"use client";

// APP-3 dispatcher — the ONLY client caller of /api/notify for in-app
// receipts. Fire-and-forget by doctrine: a receipt is an enhancement of a
// completed money event, so every failure degrades to a console line, never
// a UI error and never a re-prompt (notification-permission requests stay
// exclusively in NotificationConsent — nagging risks the platform-wide
// capability revocation, docs.world.org features-and-guidelines).

import { MiniKit } from "@worldcoin/minikit-js";
import { buildReceipt, type ReceiptEvent, type ReceiptContext } from "./receipts";

export type ReceiptOutcome = "sent" | "deduped" | "skipped" | "failed";

export async function maybeSendReceipt(
  event: ReceiptEvent,
  ctx: ReceiptContext,
): Promise<ReceiptOutcome> {
  const payload = buildReceipt(event, ctx);
  if (!payload) return "skipped";

  // Permission gate — read-only. Any throw (outside World App, bridge
  // unavailable) means "cannot receive", so skip silently.
  try {
    const perm = await MiniKit.getPermissions();
    // biome-ignore lint/suspicious/noExplicitAny: permissions payload is loosely typed in 2.x (same cast law as NotificationConsent)
    const granted = (perm.data?.permissions as Record<string, unknown> | undefined)?.notifications === true;
    if (!granted) return "skipped";
  } catch {
    return "skipped";
  }

  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; deduped?: boolean }
      | null;
    if (res.ok && j?.ok) {
      // Funnel law (G2G-6): a sent receipt is a measurable lane before any
      // badge math. Analytics must never break the app — swallow.
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "notify_sent", source: "receipt" }),
        keepalive: true,
      }).catch(() => {});
      return j.deduped ? "deduped" : "sent";
    }
    return "failed";
  } catch {
    return "failed";
  }
}
