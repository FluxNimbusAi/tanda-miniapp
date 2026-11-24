# DESIGN-E: Mini-app theming proposal vs archived ui-kit reality

Card: t_2f84bafb (supersedes Harley 17:5x handoff brief) · Author: Nimbus (@FluxHermesSubBot) · Date: 2026-11-23
Status: PROPOSAL — owner green-light word is "go". Decision gates at bottom.

## 1. Ground truth (verified 2026-11-23, live reads)

| Fact | Evidence |
|---|---|
| `@worldcoin/mini-apps-ui-kit-react` pinned at 1.6.0 | tanda-miniapp `package.json` deps (origin/main) |
| Upstream repo ARCHIVED | `gh repo view worldcoin/mini-apps-ui-kit` → `isArchived: true`, `archivedAt: 2026-11-10T09:29:46Z` |
| npm package NOT deprecated, frozen | registry `latest` = 1.6.0, `deprecated: null` — it installs, but never changes again |
| MiniKit core is separately maintained | `@worldcoin/minikit-js` / `minikit-react` at 2.0.3 (EIP-1193), mainline |
| Tabs/TabItem consumed today | `src/components/Navigation/index.tsx` (sha256-LF 79c173cb… @1,288 B post-ux2) |

**Implication:** the ui-kit is a terminal dependency. Security patches, a11y fixes, and new components will not arrive. It is safe to keep for static primitives (Tabs shell, icons layout) ONLY if we treat its CSS as frozen input, not a design system we evolve.

## 2. Proposal: own the theme layer, thin the dependency

1. **Design tokens in-repo, not in-kit.** Lift the tandabill.world Night Ledger token set (`--ink #e8eaf2`, `--paper #0a0b10`, `--accent #3ec8ff` = money/signal, `--pink #ff3e7f` = action/danger, `--muted #a7adc0`, line `rgba(255,255,255,.07)`) into `src/app/globals.css` `:root` shared by website + mini-app. One token family across surfaces; brand parity becomes a file diff, not a redesign.
2. **Wrapper, don't fork.** Keep importing `Tabs/TabItem` from the frozen kit but render them inside a Tanda `NavShell` that supplies our own focus ring, safe-area padding (`env(safe-area-inset-bottom)`), and tabular numerals for money rows. Zero copies of kit source enter the tree (license + provenance-gate clean).
3. **Escape hatch clause.** If any kit component blocks a required fix (no upstream patches possible), replace it with a local component in `src/components/` — precedent: Navigation route-wiring already bypassed the kit's dead-link defaults in #36.

## 3. Testnet-gate workaround (rehearsal vs portal reality)

World App mini-app portal does not support testnet; production posture is chain 480 (World Chain mainnet) + Circle USDC `0x79A024...24D1` + portal whitelist gate. Rehearsal lane therefore runs Sepolia 4801 through the standalone-Docker tunnel (ADR-0009) with the portal-anchor reconciliation flag (ADR-0010). Proposal: keep exactly this split — **theming work must be chain-agnostic**; tokens and layout never read `chainId`. The only chain-conditional UI stays the existing testnet banner.

## 4. Viewport gates (100dvh + overscroll) — review criteria for t_h994g5p0

Bake these into the screenshot review gate so Harley's pass is mechanical:
- Root container uses `100dvh` (never `100vh`) and `overscroll-behavior-y: contain` on scroll regions — no rubber-band to white behind dark chrome.
- @390px: headline clamp holds (already `clamp(1.55rem,7vw,3.1rem)` on landing), nav row single-line, no horizontal overflow.
- Nav tabs clear the iOS home-indicator safe area at all text sizes.
- Dark-first render only: no FOUT flash of light theme (kit defaults must be token-overridden at `:root`, not per-component).

## 5. claimablePayout model alignment — measured divergence (t_h994g5p1)

Live indexer `GET /api/settlements?bill=0x…&page=…` returns summary rows + an append-only event ledger (`settlement_id, event, tx_hash, log_index, block, seat_id, wallet, amount, at_ts, recorded_at`). It does **not** expose any `claimable`/`claimablePayout` field (grep of `services/bill_index.py` @ origin/main: zero hits). Two options, one decision needed:
- **A (client-derived):** the app derives payout-claimable state from the ledger (`SettlementExecuted` minus `SettlementRefunded` minus claimed seat events). No indexer change; model lives in one typed selector.
- **B (server-column):** indexer adds a materialized `claimable_payouts` readout at ingest. Cleaner wire shape, but touches the canonical indexer lane and its golden tests.
Recommendation: **A** for now (indexer is frozen-clean post-#34; UI model moves faster in-app), with B as the contract when production mainnet wire shape is pinned.

## 6. Decision gates

| Gate | Owner | Ask |
|---|---|---|
| "go" on this proposal | d3b0m3n | approve / redirect |
| t_h994g5p0 viewport screenshots (100dvh/overscroll) | Harley | execute against §4 criteria |
| t_h994g5p1 payout model A vs B | Flux | adjudicate once, before production cutover |
| production cutover (480 + Circle USDC + whitelist) | owner | after gates above |
