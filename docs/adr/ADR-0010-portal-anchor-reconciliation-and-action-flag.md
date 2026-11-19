# ADR-0010 — Portal anchor reconciliation and the confirm-action-name flag

- Date: 2026-11-19
- Status: Accepted (house scope — Flux ruling 4, kanban card t_70306450)
- Supersedes pins in: PR #14 route default, PR #21 SR-F1KP single-sourcing, PR #27 deep-link goldens

## Context

Recon against the World developer portal record found two anchor drifts and one
unresolved naming conflict:

1. `DEFAULT_RP_ID` in `src/app/api/rp-signature/route.ts` was
   `rp_e87d44dbb7b76d91` — a value with **no portal record**. The portal-recorded
   relying party is `rp_a779c304e4f624ce`.
2. The portal-recorded app_id `app_e691f66620f3537878f639160a0e31f7` was carried
   as copied literals in the #27 deep-link goldens and empty-string/env-only
   defaults in components.
3. **Action-name flag:** an earlier portal record lists the registered action as
   `tanda_bill_settlement`, while the frozen code enum (PR #14 / SR-F1KP, PR #21)
   uses `bill:confirm` on the signed message AND the proof. A mismatch here fails
   portal verify in prod (exactly the SR-F1KP class of bug).

Constraint: the World MCP transport is CLOSED for this cycle (2-strike rule;
no key-format guessing). Ruling 4: portal-recorded anchors are canonical
**until a live MCP read contradicts them**.

## Decision

1. **Single source:** `src/lib/portalAnchors.ts` exports `PORTAL_RP_ID` and
   `PORTAL_APP_ID`. The rp-signature route default, the InvitePanel/Verify
   deep-link defaults, and all golden-suite inputs import it — no repeated
   literals. Golden EXPECTED URLs stay byte-exact literals so any drift of the
   constant fails the suite instead of riding along.
2. **RP flip:** `DEFAULT_RP_ID := PORTAL_RP_ID` (`rp_a779c304e4f624ce`).
   `RP_ID` env still wins at request time (CI zero-env invariant preserved).
3. **Action name NOT flipped.** `bill:confirm` stays the default wire value
   because flipping on an unverified record would break the signed-action ==
   proof-action binding if the record is stale. The name is implemented as a
   pure env-overridable constant, `resolveConfirmAction()` in
   `src/lib/rpSignatureGuard.ts`:
   - client seat-join leg: `NEXT_PUBLIC_TANDA_CONFIRM_ACTION`
   - server oracle: `TANDA_CONFIRM_ACTION` (the signable set becomes
     `BILL_RP_ACTIONS ∪ {resolved}` — exactly one operator-pinned extra verb,
     the oracle does not widen to arbitrary actions)
   - both default to `bill:confirm`; unset env = byte-identical behavior to
     pre-ADR code.

## Consequences

- Deployments can pin a newly confirmed portal action name via env alone
  (no code change), but must set BOTH legs together — a client/server split
  re-creates the SR-F1KP mismatch and portal verify fails loudly (403 from the
  rp-signature oracle), never silently grants.
- Golden suites gained `src/lib/__tests__/portalAnchors.test.ts` byte-pins for
  both anchors plus default/override behavior of the action flag.

## Escalation (owner of truth: Flux)

The exact registered action name for the bill-confirm leg
(`tanda_bill_settlement` vs `bill:confirm`) is escalated to Flux: his custody
check via a live World MCP portal read when the transport revives. If the live
read contradicts either anchor, that read wins (ruling 4) and a follow-up card
flips the constant + this ADR. Until then: anchors as recorded above, action
wire default `bill:confirm`.

## Reversibility

Everything here is constant-level: revert the import swap in route.ts and the
guard/seatJoin constants to restore the previous pins. No migration, no wire
change, no state touched.
