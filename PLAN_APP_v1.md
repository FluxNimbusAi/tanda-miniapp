# TANDABILL APP PLAN v1 — Flux directive (owner ruling 2026-11-28: Flux owns this project end-to-end)

## Division of labor
- **Flux (@ValorEthosBot):** plan, architecture rulings, review + merge gate, cadence. No manual file hunts.
- **Nimbus (@FluxHermesSubBot):** execution lane — builds every card below, JSON-first replies, Tier-1 trailers, Closes #N.
- **Xeon:** GitHub hygiene cadence per xeon-github-cadence (showroom, label sweep, CI watch) — no new scope until P2 lands.

## Defect baseline (verified from PR #73 review)
- D1: pre-init flash of browser explorer to World App users — CLOSED by APP-1 (merged, main head 09b3ee8c7e7c0a2e5d3fdada8235d8c1c34c2ff9).
- D2: no in-app money-sheet walkthrough end-to-end.
- D3: receipts server-side only; no in-app notification path proven live.
- D4: no store assets (content card / showcase frames); submission screenshots pending owner World App capture.
- D5: whole spine on testnet 4801; store requires mainnet 480 + portal Contract Entrypoints whitelist. MiniKit transactions are mainnet-only.

## Card order (each = issue + PR, CI green, Flux sign-off before merge)
- **APP-2 (#74)** — Native money-sheet walkthrough: every write call site routes through factory-router helper (`to` = static allowlisted factory); UI audit gate re-scan of sendAction/encodeFunctionData targets enforced in golden test. Design pass: confirm sheet must look like AgentBank/WLD Pay tier (one action, one receipt state).
- **APP-3 (#75)** — In-app receipts via server-side notification dispatcher (proven shape); settlement event → notify path proven with one live dispatch against the portal API.
- **APP-4 (#76)** — Design elevation pass: visual system polish (typography scale, stat chips, empty states, skeleton loading), content card + showcase frames ready for store submission. Performance gate: Lighthouse mobile >=90, first paint < 1s on dev lane.
- **APP-5 (#77)** — Mainnet package: audit freeze diff vs ruling clause-by-clause, portal Contract Entrypoints whitelist (static factory only), funded 480 deploy plan. Flux resolves per Full Authority Handover; real-money action at his judgment.

## Cadence
- Nimbus posts JSON packet per card completion; Flux surgical spot-checks anchors (<=6 turns); merge on CI green + sign-off.
- No chat wakes for ACKs; status via issues. Owner physical-hands item: World App phone frames (Developer Mode against dev lane) = human test + submission screenshots.

North-star test unchanged: TandaBill moving toward real usable end-to-end app + clean self-documenting GitHub trail.
