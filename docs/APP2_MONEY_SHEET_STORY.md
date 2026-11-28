# APP-2 — The Native Money Sheet Story

Card `t_e723c7f3` · owner directive 58131 · 2026-11-27 · branch law: this file
and `src/lib/__tests__/moneySheet.golden.test.ts` are the enforcement pair.

## The story (product law)

Every money leg in TandaBill — fund, confirm, execute, claim, and every
supporting write — reaches the user as exactly **one `MiniKit.sendTransaction`
native money sheet**. That single choke point buys three things:

1. **Wallet-history trail.** Every bill write lands in the user's World App
   transaction history, so the bill's money story is auditable on the user's
   own surface, not just in our indexer.
2. **Sponsorship reach.** The portal's fee posture (gasless-for-verified)
   applies uniformly across legs — we never opt a leg out of it by bypassing
   the sheet. Our obligation is only that every leg *reaches* the sheet.
3. **No shadow signing.** There is no secondary path: no `window.ethereum`,
   no wagmi connector, no injected provider anywhere in `src` (APP-2 audit
   grep: zero hits). One sheet to sign them all.

The UI funnel is uniform: `sendAction(...)` → `ConfirmPreview` (Phantom-class
preview-before-sign gate, visual-B) → `dispatchAction(...)` →
`MiniKit.sendTransaction`.

## The entrypoint law (technical invariant)

The portal only presents a sheet when the transaction `to` is a registered
**Contract Entrypoint**. TandaBill has exactly two:

| Entrypoint            | Role                                        |
| --------------------- | ------------------------------------------- |
| Static factory        | `callBill` router — **every** bill write     |
| USDC token contract   | `approve` — the funding leg's allowance      |

Bill **clones are never transaction targets**. A direct send to a clone fails
with `invalid_contract` inside a real World App session — and unit tests,
`tsc`, and CI are all blind to that failure outside the app. Per the
world-miniapp law, **the golden is the only enforcement that exists**, so
`moneySheet.golden.test.ts` pins the shape instead of hoping the session
catches it.

## Leg census (all nine writes)

| Leg                | Route through the sheet                          |
| ------------------ | ------------------------------------------------ |
| fund               | `approve` → USDC, then `fundEscrow` → factory (two sheets, chained, one per leg) |
| confirm            | `confirmSettlement` → factory                    |
| execute            | `executeSettlement` → factory                    |
| claim              | `claimSettlement` sweep plan → factory           |
| initiate           | `initiateSettlement` → factory                   |
| refund             | `refundSettlement` → factory                     |
| addExpense         | `addExpense` → factory                           |
| rotate seat wallet | `rotateSeatWallet` → factory                     |
| registerSeat (burn)| `registerSeat` → factory — **APP-2 fix**, see below |

## The registerSeat defect and its fix (APP-2 audit finding)

**Defect.** The BRIDGE-2 "Burn seat on-chain" button encoded raw clone
calldata (`BillABI.registerSeat(...)`) and sent with `to = billAddr`. Every
other verb already rode `billAction`; this one bypassed it. In a real World
App session the sheet never appears — `invalid_contract`.

**Fix.** Route it like every other write:
`billAction(billAddr, TANDA.factory, "registerSeat", [nullifier, wallet,
stringToHex(signal)])` → `to` is always the static factory, inner calldata
wrapped in `callBill`. The golden also pins a second latent BRIDGE-2 bug found
en route: the shipped click handler passed `toBytes(signal)` (Uint8Array) where
viem's ABI encoder requires a hex string for `bytes` params — encoding threw
before any sheet could ever appear. `stringToHex` is the canonical UTF-8
signal, byte-identical to what the verify route hashes
(`keccak256(toBytes(signal))`, seatJoin.ts). **Zero contract change** — the
gate already proves the wrapper path:

- `TandaBillFactory.callBill` (factory L61) forwards to the clone with the
  original caller's address appended to calldata, and bubbles reverts
  unchanged.
- `TandaBillV2.registerSeat` (contract L222) gates on `_caller() == owner`.
  `_caller()` (L183) recovers the appended caller **only when
  `msg.sender == factory`** — the factory itself is the proof of the path, so
  a forged trailing tail cannot spoof it (direct-EOA calls fall back to
  `msg.sender`).

Owner semantics are untouched: the sheet signer must be the bill owner,
whether reached directly (scripts/tests) or forwarded (portal).

## Enforcement (`moneySheet.golden.test.ts`)

Two layers, both required by this story:

1. **Encoder pins** — all nine write verbs via `billAction` resolve
   `to === FACTORY`, the outer call is `callBill`, and the inner clone
   calldata round-trips byte-exact against an independent re-encode.
   `usdcApprove` alone targets USDC with the clone as spender.
2. **Source scan** — shipped call sites (`TandaBill`, `ClaimSweep`) can only
   `sendAction` with an `ActionSpec .to` or `TANDA.factory`, never a raw bill
   address; inline `encodeFunctionData` inside `sendAction` args is banned
   wholesale (the defect shape); `MiniKit.sendTransaction` blocks only ever
   name sanctioned targets; plus the direct regression pin that registerSeat
   is wrapped.
