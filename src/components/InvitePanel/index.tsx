"use client";

// W2.5-4 (t_edd4a5e9) — one-tap invite share panel for a live bill.
// Renders the universal deep link (lib/inviteLink) plus two taps:
//   Copy   -> clipboard (classic fallback for webviews without it)
//   Share  -> MiniKit.share native sheet; the injected `fallback` runs
//             navigator.share, then clipboard, for non-World-App browsers.
// Pure UI/read lane — no bill writes, fully reversible.
import {
  buildBillInviteUrl,
  buildInviteShareText,
  INVITE_SHARE_TITLE,
} from "@/lib/inviteLink";
import { PORTAL_APP_ID } from "@/lib/portalAnchors";
import { Button } from "@worldcoin/mini-apps-ui-kit-react";
import { MiniKit } from "@worldcoin/minikit-js";
import { useState } from "react";
import type { Address } from "viem";

export type ShareRoute = "minikit" | "web-share" | "clipboard" | "failed";

const STATUS_NOTE: Record<ShareRoute, string> = {
  minikit: "invite shared via World App ✓",
  "web-share": "invite shared via system sheet ✓",
  clipboard: "invite link copied to clipboard",
  failed: "share failed — copy the link instead",
};

/** Web-path share: native share sheet when present, else clipboard. */
async function webShare(
  url: string,
  text: string,
): Promise<ShareRoute> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title: INVITE_SHARE_TITLE, text, url });
      return "web-share";
    }
    await navigator.clipboard.writeText(url);
    return "clipboard";
  } catch {
    return "failed";
  }
}

export const InvitePanel = ({
  bill,
  appId = process.env.NEXT_PUBLIC_APP_ID ?? PORTAL_APP_ID,
  ownerUsername,
  usdc,
}: {
  bill: Address;
  appId?: string;
  ownerUsername?: string;
  usdc?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState("");

  let url: string | null = null;
  let buildError: string | null = null;
  try {
    url = buildBillInviteUrl(bill, appId, { amt: usdc, who: ownerUsername });
  } catch (e) {
    buildError = (e as Error).message;
  }

  if (buildError !== null || url === null)
    return (
      <p className="text-xs opacity-60" data-testid="invite-unavailable">
        Invite links unavailable — {buildError ?? "set NEXT_PUBLIC_APP_ID"}.
      </p>
    );

  const text = buildInviteShareText(bill, { ownerUsername, usdc });

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShareNote("clipboard blocked — long-press the link to copy");
    }
  };

  const doShare = async () => {
    try {
      // SDK contract (types-B3FhypWE + types-COxx4rrS, vendored minikit-js):
      // MiniKit.share({ ...ShareParams, fallback }) resolves to
      // { executedWith: 'minikit', data: payload } when the World App sheet
      // ran, or { executedWith: 'fallback', data: <fallback return> }.
      const res = await MiniKit.share<ShareRoute>({
        title: INVITE_SHARE_TITLE,
        text,
        url,
        fallback: () => webShare(url, text),
      });
      setShareNote(
        STATUS_NOTE[res.executedWith === "fallback" ? res.data : "minikit"],
      );
    } catch {
      // MiniKit unavailable outside World App throws (CommandUnavailable/
      // FallbackRequired); run the web path directly instead.
      setShareNote(STATUS_NOTE[await webShare(url, text)]);
    }
  };

  return (
    <div className="grid gap-1 border-t border-dashed pt-2">
      <p className="text-xs font-semibold opacity-70">Invite your bill</p>
      <input
        readOnly
        value={url}
        aria-label="bill invite link"
        data-testid="invite-url"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded border p-2 font-mono text-[11px] opacity-80"
      />
      <div className="flex gap-1">
        <Button onClick={() => void doCopy()} variant="tertiary" size="sm">
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        <Button onClick={() => void doShare()} variant="secondary" size="sm">
          Share invite
        </Button>
      </div>
      {shareNote && (
        <p className="text-xs opacity-60" data-testid="invite-status">
          {shareNote}
        </p>
      )}
    </div>
  );
};
