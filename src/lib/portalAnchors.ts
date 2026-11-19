// PORTAL-RECON (t_70306450, Flux ruling 4): portal-recorded anchors are
// canonical until a live MCP read contradicts them. Before this slice the
// rp-signature default (rp_e87d44dbb7b76d91) had drifted from the portal
// record, and the app_id literal was copied across #27 deep-link goldens.
// Single source of truth: EVERY consumer imports from here — no literals.
// NOTE: the World MCP transport was CLOSED for this cycle (2-strike; no
// key-format guessing), so these values are pinned from the portal record,
// not a live read. Contradiction protocol: docs/adr/ADR-0010.
export const PORTAL_RP_ID = 'rp_a779c304e4f624ce';
export const PORTAL_APP_ID: `app_${string}` =
  'app_e691f66620f3537878f639160a0e31f7';
