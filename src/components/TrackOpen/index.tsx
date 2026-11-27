"use client";
// G2G-6 open beacon: fires ONE /api/track {kind:"open", source} per browser
// session. source = ?src=<n1..n3b|share> when present (notification or share
// arrival), else organic. sessionStorage dedup — reloads don't inflate the
// open-rate that feeds the official >=15% badge bar. No PII in the payload.
import { useEffect } from "react";

const SESSION_KEY = "tanda-tracked-open";

export function TrackOpen() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      const src = new URLSearchParams(window.location.search).get("src");
      const allowed = ["n1", "n2a", "n2b", "n2c", "n3a", "n3b", "share"];
      const source = src && allowed.includes(src) ? src : "organic";
      sessionStorage.setItem(SESSION_KEY, source);
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "open", source }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* private-mode / beacon failure must never touch the UI */
    }
  }, []);
  return null;
}
