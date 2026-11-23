# hosting/ — Tanda mini-app hosting (Plan B, ADR-0009)

Pre-staged, zero-external deployment lane. **Nothing in this directory
deploys or reconfigures anything outside this repo.** The portal
`integration_url` swap stays gated until the go-live decision; when it comes,
flipping the token/host choice is a formality because everything here is
already CI-validated.

```
hosting/
├── Dockerfile                 production multi-stage image (node:26-alpine)
├── README.md                  this file
├── staging/                   local HTTPS proof (no mkcert, no accounts)
│   ├── gen-cert.sh            self-signed localhost cert via openssl
│   └── https-gateway.mjs      zero-dep TLS->standalone reverse proxy
└── tunnels/                   staging exposure runbooks (templates only)
    ├── cloudflared.md
    ├── ngrok.md
    └── configs/               pre-validated config templates (both lanes)
```

## 1. Production build (standalone)

`next.config.ts` sets `output: 'standalone'` + a pinned `outputFileTracingRoot`.
The build emits `.next/standalone/` — a self-contained Node server with only
traced production deps.

```bash
npm run build
# standalone needs these siblings (exactly what the Dockerfile copies):
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
PORT=3000 node .next/standalone/server.js
```

Verified on this host 2026-11-19: `GET /` → 200 with zero env vars set.
Runtime env that matters: `AUTH_SECRET`, `MINIKIT_APP_ID`/`NEXT_PUBLIC_APP_ID`
(server-side notify), `INDEXER_URL`-adjacent config — all request-time reads.
`NEXT_PUBLIC_*` are **inlined at build time** (see Dockerfile note + ADR-0009).

## 2. Docker image

The PC host has no docker daemon by design; the image is proven by CI on every
PR (`docker-build` job in `.github/workflows/ci.yml`). Anywhere docker exists:

```bash
docker build -f hosting/Dockerfile -t tanda-miniapp .
docker run --rm -p 3000:3000 -e AUTH_SECRET=*** tanda-miniapp
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
```

Known gotchas already handled: `ENV HOSTNAME=0.0.0.0` (docker's injected
container-id HOSTNAME otherwise binds the standalone server to an unreachable
name), `.next/static` + `public` copied beside the standalone tree, non-root
`nextjs` user.

## 3. Local HTTPS staging proof (no mkcert, no accounts)

World ID/Minikit flows need a secure context; mkcert is absent on this host.
Instead: openssl self-signed leaf (SAN `localhost`/`127.0.0.1`/`::1`) behind a
zero-dependency Node TLS gateway fronting the standalone server.

```bash
# terminal 1 — standalone server (build steps above)
PORT=3100 node .next/standalone/server.js
# terminal 2 — cert + gateway
bash hosting/staging/gen-cert.sh
HTTPS_PORT=3443 UPSTREAM_PORT=3100 node hosting/staging/https-gateway.mjs
# terminal 3 — prove
curl -sk https://localhost:3443/                                  # SSR HTML
curl -sk 'https://localhost:3443/api/settlements?bill=0x…40hex'   # JSON over TLS
curl -sk https://localhost:3443/ | grep -o '/_next/static/[^"]*' | head -1
```

Proof banked 2026-11-19 (receipt in PR body): TLSv1.3 / TLS_AES_256_GCM_SHA384,
`GET /` 200, static asset 200, API validation 400 + valid-shape 200, and the
negative test `curl` (no `-k`) → **exit 60** — cert rejection is real, TLS
verification is active.

**Trust caveat:** the self-signed cert is trusted by nothing by default.
Use `curl -k`, browser "Advanced → Continue", or `NODE_EXTRA_CA_CERTS` for
Node test runners. **World App's webview will NOT accept it** — this kit proves
server plumbing and secure-context behaviour on a desktop browser only. Real
device staging requires a tunnel (next section) or the go-live host, both of
which terminate TLS with CA-issued certs.

## 4. Tunnel exposure (runbooks + templates, no accounts created)

Boundary compliance: this PR creates **no** external accounts. Both tunnel
providers need one (except cloudflared's ephemeral quick tunnel — no sign-up,
random URL + browser interstitial; desktop-only). Start at
`tunnels/cloudflared.md` (preferred: stable hostname, free, CA-issued TLS) or
`tunnels/ngrok.md` (fastest first URL). Pre-validated config templates live in
`tunnels/configs/`; runbooks carry the exact command sequences and the
World-App suitability notes.

## 5. Go-live checklist (gated — do not execute pre-decision)

1. Owner picks host: any container host for `hosting/Dockerfile`
   (Fly.io / Render / VPS / Docker) — or drop Plan-A Vercel if `VERCEL_TOKEN`
   is ever granted.
2. Provide runtime secrets: `AUTH_SECRET` (≥32B), `MINIKIT_APP_ID`,
   `NEXTAUTH/AUTH_URL` = final https origin.
3. Decide `NEXT_PUBLIC_*` build args (inlined at image build — see Dockerfile
   note); rebuild with `--build-arg` per variable.
4. Provision the tunnel/domain per `tunnels/` runbook; confirm `GET /` == 200
   over public https and World App opens the URL.
5. **Portal step (the gated one):** snapshot `get_app_config`, swap
   `integration_url` to the staging/live origin. Rollback = restore snapshot
   value. Everything above is reversible without touching the portal.
