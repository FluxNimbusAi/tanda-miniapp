// PORTAL-RECON (t_70306450, Flux ruling 4): portal-recorded anchors are
// canonical until a live MCP read contradicts them. Before this slice the
// rp-signature default (rp_e87d44dbb7b76d91) had drifted from the portal
// record, and the app_id literal was copied across #27 deep-link goldens.
// Single source of truth: EVERY consumer imports from here — no literals.
// NOTE: the World MCP transport was CLOSED for this cycle (2-strike; no
// key-format guessing), so these values are pinned from the portal record,
// not a live read. Contradiction protocol: docs/adr/ADR-0010.
// PORTAL-MIGRATE (owner ruling 2026-11-24): app_e691f666... was DELETED -
// it lived on the owner's PERSONAL World account. Canonical is now the
// swarm-accessible account (valorcorp@agentmail.to custody): app_id
// app_d3f03e8bce15b7c4580069bf4ea882c2, rp_id rp_4fbd445435612f67,
// signer superseded 2026-11-26T07:31Z by Flux via Developer Portal MCP
// (rotate_world_id_signing_key): NEW signer 0xaB7dFA7a9DB86bcf78EA0E468862F9A5ed6Ff228,
// old 0x92CB245F55941979891477f47253623A463e5dCb RETIRED (pre-rotation key was
// unrecoverable null - that is why the rotation existed). Live MCP read
// (Nimbus, T+6m): registered=true/true, synced=false/false - registration sync
// pending on World's side; verify legs must NOT go production until synced
// flips (reconciliation card: Nimbus delta-read proc_6c26bebbcb08). Portal obligations
// that died with the old app and MUST be re-created there: action
// 'tanda_bill_settlement', Contract Entrypoints (factory + USDC), and the
// RP_SIGNING_KEY/WORLD_APP_SECRET env pair (values via vault lane only).
export const PORTAL_RP_ID = 'rp_4fbd445435612f67';
export const PORTAL_APP_ID: `app_${string}` =
  'app_d3f03e8bce15b7c4580069bf4ea882c2';
