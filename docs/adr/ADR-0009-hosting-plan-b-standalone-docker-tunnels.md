# ADR-0009: Hosting Plan B — standalone+Docker artifact lane, local HTTPS proof, pre-staged tunnels

- **Status:** Proposed — pending Flux gate
- **Swarm-Card:** t_4d70d038
- **Executed-By:** Nimbus (PC node, DESKTOP)
- **Adjudicated-By:** Flux (gate pending)
- **Date:** 2026-11-19
- **Scope:** `tanda-miniapp` repo: `hosting/`, `next.config.ts`, `.dockerignore`, `.github/workflows/ci.yml`. Portal `integration_url` and any external provisioning are explicitly OUT of scope (pre-stage only).

## Context

M4-1 (m4_hosting, 11-19 13:10) ratified Vercel Phase-1 as the hosting plan
(zero-DNS, reversible), but it dead-ended on `VERCEL_TOKEN` →
`[HUMAN_GATE]`. Flux GO ruling #2 (11-19): Plan B/C now, pre-stage only —
build everything that does **not** need a new account, a token, or the portal
write, so that when the token flip / host choice lands it is a formality.
Host constraints proven this session: no docker daemon on the PC, no mkcert,
openssl 3.5.9 present, node 26.12.1, cloudflared/ngrok both gate behind
accounts (boundary 3 = zero external provisioning this card).

## Decision

1. **Standalone build artifact.** `next.config.ts` gains
   `output: 'standalone'` plus a pinned `outputFileTracingRoot` at the project
   dir. The pin is load-bearing, not style: Next 15's default trace root
   resolves via the git repo root, which (a) nested the entire standalone
   tree under `.next/standalone/.worktrees/<name>/` in our worktree lane
   (observed, then fixed, then re-verified flat) and (b) is exactly the kind
   of inferred-path fragility Docker builds must not inherit.
2. **Production Dockerfile** (`hosting/Dockerfile`): 3-stage
   node:26-alpine (deps → build → runner), non-root `nextjs` user,
   `.next/static` + `public` copied beside the standalone tree, and
   `ENV HOSTNAME=0.0.0.0` — the canonical standalone-in-docker failure mode
   (docker injects `HOSTNAME=<container-id>`, server binds it, port
   unreachable) is pre-handled. `NEXT_PUBLIC_*` are deliberately **not**
   declared with empty defaults: empty strings shadow the request-time
   fallbacks in `src/config/tanda.ts` (`??` only skips `undefined`); go-live
   adds per-var `ARG`/`ENV` pairs, documented in-file.
3. **CI as the image's proving ground.** New `docker-build` job (gated on
   `web`): `docker build -f hosting/Dockerfile .` + container smoke `GET /`
   == 200 with **zero env**. Grounded locally 2026-11-19:
   `node .next/standalone/server.js` answers 200 for `/`, serves
   `/_next/static/*`, and executes API route handlers (400 invalid-bill JSON,
   200 valid-shape) without `AUTH_SECRET` or any World env.
4. **Local HTTPS proof without mkcert** (`hosting/staging/`):
   `gen-cert.sh` (openssl self-signed leaf, SAN `localhost`/`127.0.0.1`/`::1`,
   30-day, keys gitignored) + `https-gateway.mjs` (zero-dep TLS-terminating
   reverse proxy, hop-by-hop header hygiene, boot banner prints the leaf's
   SHA-256 fingerprint for receipts). Proof banked: TLSv1.3 /
   `TLS_AES_256_GCM_SHA384`, `GET /` 200 over https, static 200, API 400/200
   over https; negative test curl-no-`-k` → exit 60 (verification genuinely
   enforced). **Trust caveat by design:** self-signed ⇒ trusted by no client
   by default and **rejected by World App's webview**; this kit proves plumbing
   and secure-context behaviour desktop-only. Public device staging is the
   tunnels' job (CA-issued edge certs).
5. **Tunnels: runbooks + pre-validated templates only.**
   `hosting/tunnels/{cloudflared.md,ngrok.md}` +
   `configs/{cloudflared.config.example.yaml,ngrok.config.example.yml}`
   (schemas: cloudflared v2024.02+ flat keys with mandatory `http_status:404`
   catch-all; ngrok v3 `version:"3"` + named tunnels; both YAML-linted clean
   in CI-adjacent validation, placeholders only). One factual refinement to
   the ruling: cloudflared quick tunnels need **no** account — allowed here as
   documented desktop-only plumbing check (ephemeral URL + interstitial ⇒
   never `integration_url`-grade). Named cloudflared tunnel is the preferred
   real lane; ngrok is the alt lane.

## Alternatives considered

- **Vercel Phase-1 (Plan A):** remains best-if-token; blocked on
  `VERCEL_TOKEN` human gate — that gate now blocks nothing else because B is
  shippable standalone.
- **Run node server via pm2 on the PC + expose port:** rejected — PC firewall
  posture is RDP/WinRM-off, :8080-loopback-only; punching a public listener
  on the workstation violates the host security convention for zero gain over
  a tunnel.
- **Trycloudflare quick tunnel as the main staging lane:** rejected for device
  work (URL churn + interstitial) though kept as the zero-account proof step.
- **selfsigned npm package / node-forge for cert gen:** rejected — adds a
  dependency when openssl 3.5.9 is already on the host.

## Consequences

**Positive:** deploy becomes config-and-paste (any container host runs the
image today); `docker-build` CI job prevents Dockerfile bit-rot from future
PRs; the HTTPS + tunnel lanes are proven and templated, so World App device
testing needs ≤15 min of account-side work and nothing else; fully reversible,
zero external writes — the portal `integration_url` remains the single gated
step, exactly as ruling #2 demands.

**Negative / watch-outs:** (1) `NEXT_PUBLIC_*` inlining means device-testing
with non-default chain/config needs a **rebuild**, not an env flip — go-live
checklist item 3 in `hosting/README.md`. (2) Standalone does not bundle
`.next/static`/`public`: any hand-rolled host script must mirror the
Dockerfile's two copies (README §1 documents it). (3) The tunnel runbooks
encode schemas as of 2026-11; re-verify against provider docs at execution
time (templates fail loudly, not silently — cloudflared refuses bad ingress,
`ngrok config check` rejects schema drift). (4) Two new CI minutes/PR for
docker-build — accepted cost for artifact integrity.

## Proof ledger (this card)

| Claim | Evidence |
|---|---|
| standalone flat layout | rebuild after trace-root pin: `server.js`, `node_modules/`, `package.json` at `.next/standalone/` root |
| prod build green | `npx next build` ✓ 9 routes, static gen 9/9 |
| zero-env container expectation | local standalone :3100, `GET /`→200, no AUTH_SECRET |
| HTTPS plumbing | gateway :3443 TLS1.3 AES-256-GCM; `/` 200, asset 200, API 400+200; cert fp `1E:10:3A:D7:…:97:29` pinned in gateway banner |
| trust not rubber-stamped | curl w/o `-k` → exit 60 |
| templates inert-but-valid | both YAML lint clean; all secrets as `<PLACEHOLDER>` |
