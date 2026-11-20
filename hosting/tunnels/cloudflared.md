# Cloudflared staging tunnel — runbook (ADR-0009 Plan C, preferred lane)

Why preferred: free tier covers this use, TLS terminates at Cloudflare's edge
with a **CA-issued cert** (World App webview accepts it), and a named tunnel
gives a stable hostname so `integration_url` never has to change.

Boundary note: this PR creates **no accounts**. Steps 0–1 below are the
no-account desktop-plumbing lane; steps 2+ (named tunnel) need a Cloudflare
account + a zone you control and are executed only at staging/go-live time.

## 0. Install (pick per host)

```bash
npm install -g cloudflared                     # PC staging host (verified path, note below)
# winget install --id Cloudflare.cloudflared   # fallback if npm lane unavailable
# brew install cloudflared                     # macOS
# apt: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared --version                          # expect 2024.x+ (config v2 schema)
```

Note (npm lane, live-verified 2026-11-20): npm pkg `cloudflared@0.7.3` postinstalls
the real binary — reported `cloudflared version 2026.11.1`. npm 12+ blocks install
scripts by default; global install prompted an allow — approve `cloudflared`
(or `--allow-scripts=cloudflared`) once.

## 1. Quick tunnel — zero account, ephemeral (phone-testable staging proof)

```bash
cloudflared tunnel --url http://127.0.0.1:3000
# prints https://<random>.trycloudflare.com — valid CA-issued TLS
```

**Live proof on record (t_b3e207f9, 2026-11-20):** full stack built from
`origin/main` (de161fa), `npm run start` on :3000, quick tunnel up in ~10 s
(quic conn atl16). From *outside* via public TLS: landing 200 with ModeGate
dual-mode SSR markup present; `GET /api/settlements?bill=0xbe43…&page=1` returned
real indexer rows through the Next proxy → bill_index :8096 (1 settlement,
4 events, CF-Ray header confirms edge path); malformed bill → 400. `ssl_verify_result=0`
(CA chain OK). So the quick tunnel is **usable as the phone-testable staging
proof lane with zero accounts** — curl receipts never saw an interstitial
(non-browser UA passes straight through).

Caveats (still true): URL changes every restart → never put it in
`integration_url` (pre-staged portal record stays as-is); browser first-visit may
show Cloudflare's "TOUCH TO PROCEED" interstitial (UA-gated; verify World App
webview once manually before relying on it); no access control — treat every
bill/rp endpoint as public while tunneled, tear down when done.

## 2. Named tunnel — stable hostname (needs Cloudflare account + own zone)

```bash
cloudflared tunnel login                                   # browser OAuth once
cloudflared tunnel create tanda-staging                    # -> ./<UUID>.json creds
UUID=$(basename ./tanda-staging-*.json .json)
cloudflared tunnel route dns tanda-staging staging.tanda.<your-zone>.com
```

Config: copy `configs/cloudflared.config.example.yaml` →
`%USERPROFILE%\.cloudflared\config.yml` (or `--config`), replace
`<TUNNEL_UUID>`, `credentials-file`, `account`, and the ingress hostname —
template structure matches the v2024.02+ schema (flat `tunnel:`/`ingress:`
keys; catch-all `http_status:404` entry is mandatory).

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
# service-ize on the PC: cloudflared service install  (Windows service)
```

Verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://staging.tanda.<zone>/  # 200
```

## 3. Hardening while staged (recommended)

- Cloudflare Access (free ≤50 users) policy on the hostname → phone-laptop
  testing without leaking the URL.
- `metrics: 127.0.0.1:34415` in the template keeps the metrics endpoint
  loopback-only.
- The creds `<UUID>.json` is a secret — keep outside the repo (template path
  placeholder lives in `%USERPROFILE%\.cloudflared\`).

## 4. Teardown (reversibility)

```bash
cloudflared tunnel delete tanda-staging
cloudflared tunnel route dns delete tanda-staging staging.tanda.<zone>   # or DNS record delete
```

Nothing persistent outside the repo survives teardown.
