"use client";

// APP-3 (t_147cd41a) — in-app money-event RECEIPTS. Owner directive 58131:
// settlement/claim events pair with the existing keyed /api/notify lane
// (server-side developer.worldcoin.org/api/v2/minikit/send-notification —
// the SDK 2.0.3 has NO client-side notification command; MiniKit's role is
// the permission gate + session wallet + userOpHash anchor).
//
// Laws this module obeys:
// - Username addressing (KAIZEN-9): identity inside the copy is the literal
//   `${username}` token — World's send-notification API substitutes it
//   PER RECIPIENT server-side (zero client resolution, zero raw wallets in
//   copy).
// - Functional register: factual money sentences, no exclamation marks, no
//   marketing trio (demo|beta|trial), title <= 72, message <= 280.
// - Idempotency (C3 hard-enforcement law): key REQUIRED, deterministic per
//   (event, userOpHash), charset [A-Za-z0-9:._-]{8,128} — replay of a known
//   key answers 200+deduped, so double-fire is harmless by construction.
// - P1.1b seam law: root-relative mini_app_path only ("/bill/<addr>" —
//   /api/notify owns app_id and resolves the worldapp:// form).

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export type ReceiptEvent =
  | "executeSettlement"
  | "refundSettlement"
  | "claimSettlement";

export type ReceiptContext = {
  /** actor wallet — the ONLY recipient of an in-app receipt */
  wallet: string;
  /** terminal userOpHash: the idempotency anchor (unique per on-chain act) */
  userOpHash: string;
  /** single-bill context; omit for a multi-bill sweep (lands on /home) */
  bill?: string;
  /** canonical trimmed USDC figure (formatUSDC output), optional */
  usdc?: string;
  /** bills touched (sweep copy only) */
  count?: number;
};

export type ReceiptPayload = {
  wallet_addresses: string[];
  localisations: { language: string; title: string; message: string }[];
  mini_app_path: string;
  idempotency_key: string;
};

/** Copy table — one honest sentence per money event. The `${username}`
 *  token is substituted by World's API; amounts ride only when known. */
export function receiptCopy(
  event: ReceiptEvent,
  ctx: ReceiptContext,
): { title: string; message: string } {
  const amt = ctx.usdc ? `${ctx.usdc} USDC` : "the escrow";
  switch (event) {
    case "executeSettlement":
      return {
        title: "Your bill has been settled",
        message:
          "${username}, settlement of " +
          (ctx.usdc ? `${ctx.usdc} USDC` : "the bill") +
          " executed on-chain. Payouts are ready for each seat to claim — open your bill to see the vector.",
      };
    case "refundSettlement":
      return {
        title: "Bill refunded in full",
        message:
          "${username}, the refund door was used: " +
          amt +
          " returned to the funder in full and the bill is closed.",
      };
    case "claimSettlement": {
      const n = ctx.count ?? 1;
      return {
        title: "Payout claimed",
        message:
          "${username}, you claimed " +
          (ctx.usdc ? `${ctx.usdc} USDC` : "your payout") +
          ` from ${n} settled bill${n === 1 ? "" : "s"}. The funds are in your seat wallet now.`,
      };
    }
  }
}

/** Pure payload builder — fail-closed to null on any malformed anchor so a
 *  caller can never dispatch garbage into the keyed lane. */
export function buildReceipt(
  event: ReceiptEvent,
  ctx: ReceiptContext,
): ReceiptPayload | null {
  if (
    !ADDRESS_RE.test(ctx.wallet) ||
    !HASH_RE.test(ctx.userOpHash) ||
    (ctx.bill !== undefined && !ADDRESS_RE.test(ctx.bill))
  ) {
    return null;
  }
  const { title, message } = receiptCopy(event, ctx);
  return {
    wallet_addresses: [ctx.wallet.toLowerCase()],
    localisations: [{ language: "en", title, message }],
    mini_app_path: ctx.bill ? `/bill/${ctx.bill.toLowerCase()}` : "/home",
    idempotency_key: `rcpt:${event}:${ctx.userOpHash}`,
  };
}
