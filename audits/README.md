# audits/

Landing zone for security review reports covering the mini-app surface.

## Status (2026-11-27)

**No external third-party audit yet.** TandaBill runs on World Chain
testnet 4801, where escrow carries no real value. A third-party review is
planned as a mainnet-GA precondition; when reports land they will be
committed here with their sha256 receipts stated alongside.

## What exists today instead

- **CI-enforced suites per PR**: unit + golden test matrix
  (compliance goldens pin the security-relevant flows — oracle fail-closed,
  anchor coercion, idempotency gate).
- **Canonical evidence directory**: the contract/indexer side publishes
  graded artifacts (security sweeps, route matrices, coverage censuses) in
  [`FluxNimbusAi/tanda/proofs/`](https://github.com/FluxNimbusAi/tanda/tree/main/proofs)
  with the index in
  [`tanda/audits/README.md`](https://github.com/FluxNimbusAi/tanda/tree/main/audits).

## Naming law for future reports

`YYYY-MM-DD_<auditor>_<scope>.pdf` plus a sibling `.md` summary that
states: scope, environment, findings count by severity, and the sha256 of
the report bytes — so the file itself is verifiable, not just linked.
