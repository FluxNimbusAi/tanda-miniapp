# Security Policy — tanda-miniapp

This is the World App mini-app surface of TandaBill: the Next.js client,
its API routes, and the signing/notification plumbing between a verified
human's browser and the escrow contract. The escrow rules themselves live
in [`FluxNimbusAi/tanda`](https://github.com/FluxNimbusAi/tanda).

One law governs every claim below: **the contract state is the only source
of truth about money — any surface here that disagrees with it is a bug.**

## Reporting a vulnerability

Email **tandabill-support@agentmail.to** (also printed on our `/terms`
and `/privacy` pages) with:

- what surface (route, component, flow) and how to reach it
- a minimal reproduction — testnet steps only; never exploit live users
- what you believe the impact is

We acknowledge within 72 hours. Triage is by funds-at-risk, not by label:
anything that can move or strand escrow without a seat-owner's action is
critical and outranks all feature work.

## Scope

In scope:

- API routes: `/api/rp-signature` (signing oracle), `/api/notify`,
  `/api/track`, and the bill read lanes
- portal-anchor reconciliation and mode gating (`src/lib/portalAnchors.ts`,
  `ModeGate`)
- World ID / RPC verification client flows and minikit integration

Out of scope (by design, not dismissal):

- the escrow contract economics — governed by the `tanda` repo policy
- testnet-only value: World Chain 4801 carries no real funds today;
  mainnet GA re-scopes this document
- social engineering of seat participants — the protocol's answer is the
  user-facing confirm-window and auto-refund rules

## Known issues (live honesty section)

- **Analytics degrade soft, not silent-clean.** `/api/track` returns
  `202 {tracked:false, note}` when the indexer lane is unreachable or
  unconfigured — telemetry can be lost during infra churn. No user funds
  path is involved; the app never errors on analytics failure.
- **Open-rate attribution counts browser sessions, not verified humans.**
  This is a deliberate privacy posture: zero PII in event payloads.
  Expect attribution noise, not identity precision.
- **No external audit yet.** See [`audits/README.md`](audits/README.md)
  for the current evidence base and what a third-party review gate looks
  like before mainnet.

## Hardening already in place (so reports land faster)

- Signing oracle: authenticated-only, per-action allowlist, rate window;
  anonymous requests fail closed (CI-asserted golden tests).
- Voided/rotated World ID portal anchors are coerced at runtime and
  asserted in CI — a stale anchor cannot silently sign.
- Notification dispatch requires an idempotency key with replay dedup.
- Every commit carries provenance trailers
  ([`FluxNimbusAi/provenance-gate`](https://github.com/FluxNimbusAi/provenance-gate)
  `TRAILER_SCHEMA.md`) and a nightly sweep re-validates the public record.
