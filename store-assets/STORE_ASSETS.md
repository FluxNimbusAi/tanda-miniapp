# TandaBill — World App store assets (APP-4)

Lane: Nimbus · Date: 2026-11-27 · Spec: bridge/APPLICATION_REALITY_20261127.md line 29
(owner directive 58131) · Voice law: STORE_COPY_FINAL_20261124.md (proof-escrow category)

## Portal requirement → shipped asset

| Surface | Spec | Asset | Status |
|---|---|---|---|
| App icon | square, non-white background | `icon_1024.png` (portal) + `icon_512.png` / `icon_192.png` (repo/PWA/OG) | ✅ shipped — v2 escrow-pin brand (rasterized from `tanda_icon_1024_v2.svg`, the vision-verified FINAL icon; icon REUSE per spec, no new mark) |
| Content card | 345×240 @3x = 1035×720 PNG, no baked text, bottom 94 px clear, no border radius | `content_card_1035x720.png` | ✅ shipped — certified below |
| Showcase images | 1–5 in-app screens (owner World App captures) | — | ⏳ owner-hands lane; recipe below |
| Description | ≤25 words | 11 words | ✅ shipped below |

## Content card certification (measured, not asserted)

- Size/format: 1035×720 PNG, full-bleed rectangle, no border radius.
- No-text: vision-audited — zero letters/numbers anywhere; composition is the brand
  escrow-pin (gradient bar + slot + verified check) plus an abstract four-node
  settlement path (funded → confirmed → executed → claimed).
- Bottom-94-clear: programmatic audit of rows 626–720 — pure background-gradient
  continuation, max vertical pixel delta 1 (mean 0.02). Store title+icon overlay zone unobstructed.
- Palette: Night Ledger tokens (#0a0b10→#12141d base, #ff3e7f→#8b7bff→#3ec8ff gradient) —
  identical to icon v2 and the live dark shell.

## Description (≤25 words — primary)

> Escrow-backed deals that settle themselves. Two parties. Verified humans. No ghosting.

11 words / 86 chars. NOTE: STORE_COPY_FINAL tagged this "≤80 chars" — it is 86; if the
portal field is char-capped at 80 use the compliant variant (10 words / 79 chars):

> Escrow deals that settle themselves. Two parties. Verified humans. No ghosting.

## Receipts (sha256 of bytes as committed)

| File | sha256 | Bytes |
|---|---|---|
| content_card_1035x720.png | `f95927823f09d1fdea057ce0e1195574d912223b63a3e454cb256ba8642585cc` | 165893 |
| icon_1024.png | `2c2d40fe44cc80a12e0db57b6a1733859fb3b76b3fa18e1e157f53dcd780e749` | 555629 |
| icon_512.png | `61c2ab008732bbb54d185e8f949bf72570a4f4fd4480f85766e5e6b7059f1439` | 41782 |
| icon_192.png | `5e701bf5ef8edc9476eaf06e959a65444d941d5c363e7c61d5169dbf9667b5c1` | 10223 |

`public/icon-192.png` / `public/icon-512.png` swapped to the v2 brand in the same commit
(they carried the stale pre-v2 pouch mark; manifest.ts + layout.tsx OG reuse them, so the
PWA/identity surfaces now match the portal icon). No golden pins icon bytes — verified by
grep (only path references in layout.tsx/manifest.ts).

## Showcase set — status + capture recipe (owner-hands)

Spec pins the source as **owner World App captures**. Agent-side browser captures were
attempted and REJECTED for store use (evidence, not vibes):

1. Live copy still carries jargon the FINAL voice bans: "Live Sepolia (4801) state",
   "factory clone or legacy direct", "Probe Bill (era + roster)" (vision-transcribed from
   production at 390×844 @3x, 2026-11-27).
2. `/bill/<settled>` in browser-degraded mode hangs at "loading trail from the indexer…"
   past 15 s — the direct-truth chain fallback does not serve this surface in prod yet.

Recipe for the five shots (per STORE_COPY_FINAL §51–58), taken inside World App on the
owner phone (Settings → screenshots, then crop to 9:19.5):

1. Bill home — settled bill showing the full lifecycle timeline (receipt, NOT "Fund escrow").
2. Landing hero — verified-human badge row / per-seat World ID orb.
3. Create-bill — seat invite preview (InvitePanel).
4. Confirm sheet — preview-before-sign trust gate.
5. Explorer — read-only bill lookup with live chips.

Blockers for clean shots: jargon-scrub gate + degraded-mode trail (tracked under APP-1/2
lanes). Once those land, owner device captures are the authoritative set; portal upload
should not be submitted until all four surfaces (icon/card/showcase/description) are in.
