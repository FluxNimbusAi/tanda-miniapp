# Tanda MiniApp — W10 Frontend Spec: Positioning, Verified-Seat Badges, Notifications (2026-11-16)

Status: READY-TO-BUILD (frontend lane = Nimbus; no contract dependencies except Q4-era note in the rotation proposal).
Repo baseline: main @2772c8f — W8 shell green (9/9 pages, tsc clean, era-detect probeBill live).

## 1. P0.2 — Escrow-guarantee positioning (copy pass)
Source of truth: research lane 1+3 (World Chat ships first-party plain splitting; Splitwise Pay = custodial
hostage-state complaints; Collctiv line "collect money upfront so you don't pay out for people and cross
your fingers"). Do NOT market "split a bill" — market the guarantee.

Copy deck (screens → text):
- Landing/splash: **"Funded means funded."** Sub: "USDC sits in escrow from day one. When everyone confirms,
  money moves — nobody can ghost your payout."
- Bill create CTA: "Start a guaranteed bill" (never "Split a bill").
- Fund step: "Escrow locked — the math is done, the money's already here."
- Confirm screen header: "Your share is already in the contract. Confirming just says yes — it can't be un-funded."
- Settled screen: "Settled on-chain. No IOUs, no reminders needed, no begging."
- Store listing (dev portal): lead with "zero-fee, escrow-guaranteed, verified-humans-only group bills";
  explicit contrast list: no entry caps, no ads, no custody — never name World/Splitwise trademarks in listing
  (policy: no 'official' branding).

## 2. P0.3 — Verified-human seat badges ("no bots in your bill")
- Seat card (roster + confirm screens): green World ID check chip + shortened per-bill identity from the W8
  seat-gate schema (nullifier-identity, per-bill PK, client_metadata scoping — see tanda docs W8 v1 schema).
  Show the per-bill PK, never the raw nullifier (privacy scoping already decided).
- Bill header strip: "N verified humans · 0 bots" (count = active seats with verified attestation flag).
- First-run explainer modal (one-time, per user): why seats = humans: "Every seat is a real, verified person —
  ghosts and bots can't take your money with them."
- Post-rotation note (if Q2/Q3 approved): rotated seats show "wallet updated · re-verified" chip from
  SeatWalletRotated + fresh proof event trail — keeps the invariant visible.

## 3. P1.1 — Retention notifications (platform-native)
Mechanism (verified @ docs.world.org, 2026-11-16): server-side POST
`https://developer.worldcoin.org/api/v2/minikit/send-notification` (Bearer dev-portal API key), body =
app_id, wallet_addresses[], localisations[{language,title,message}] (en/es/fr minimum; `${username}`
templating supported), `mini_app_path` deep-link `worldapp://mini-app?app_id=…&path=…`.
Prereqs: (a) Developer Portal Advanced setting → notifications permission requested; (b) user-side consent
via MiniKit requestPermission (get-permissions to check state); (c) limits: 40 notif / 4 h while unverified —
plan the beta ramp around it; (d) follow Features & Guidelines: opt-in, low frequency, meaningful triggers —
abuse revokes the capability; done right it can earn the World App home-screen badge.

Trigger library (mapped to Tanda state):
| # | Trigger | When | Deep link | Copy |
|---|---------|------|-----------|------|
| N1 | Unsettled nudge | open bill, expense silent >7d | /bill/{id} | "Still ${n} unsettled on ${billName}" |
| N2 | Confirm request | settlementInitiated, seat not in confirmedMask, +2h/+20h | /bill/{id}/confirm | "You're 1 of ${k} holding ${billName} — tap to confirm" |
| N3 | Window countdown | fullyConfirmedAt+WINDOW-1h | /bill/{id} | "Settlement executes in ~1h" |
| N4 | Settled receipt | SettlementExecuted | /bill/{id}/receipt | "Settled ✓ ${usdc} paid to your wallet" |
| N5 | Refund escape fired | SettlementRefunded | /bill/{id} | "72h passed — escrow returned to funder" |
| N6 | Monthly recap | 1st, per user with ≥1 bill | /history | "${count} bills settled this month · ${total} USDC through escrow" |
Scheduler: cron in the app server (Vercel cron or worker), state polled from chain via existing indexer
(bill_index per W8 design). N2 is the Splitwise-Pro-equivalent retention driver (cadence nudge, lane-1 insight).

Implementation slices (each independently shippable):
1. consent banner on home (MiniKit requestPermission) + store grant state.
2. /api/notify route (server-only, holds API key in env — never client) + localisation payloads.
3. indexer job → trigger table (billId, seatWallet, kind, dueAt, dedupKey).
4. N1–N4 wired; N5/N6 next pass.
Privacy guardrail: notifications go only to wallets that are seats of that bill AND granted permission;
no marketing blasts (guidelines compliance = capability preservation).

## 4. Sequencing against W10 backlog
This spec ships P0.2 + P0.3 + P1.1 fully frontend/server-side — contract only needed for P0.1 ruling (Flux,
separate doc) and P1.3 weights math (later). Notification beta ramp must respect 40/4h until app verified.
