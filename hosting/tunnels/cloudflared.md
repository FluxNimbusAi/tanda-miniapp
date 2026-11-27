# Cloudflared staging tunnel — runbook (ADR-0009 Plan C, preferred lane)

Why preferred: free tier covers this use, TLS terminates at Cloudflare's edge
with a **CA-issued cert** (World App webview accepts it), and a named tunnel
gives a stable hostname so `integration_url` never has to change.

Boundary note: this PR creates **no accounts**. Steps 0–1 below are the
no-account desktop-plumbing lane; steps 2+ (named tunnel) need a Cloudflare
account + a zone you control and are executed only at staging/go-live time.

## 0. Install (pick per host)

```bash
winget install --id Cloudflare.cloudflared     # Windows (PC staging host)
# brew install cloudflared                     # macOS
# apt: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared --version                          # expect 2024.x+ (config v2 schema)
```

## 1. Quick tunnel — zero account, ephemeral (desktop browser only)

```bash
cloudflared tunnel --url http://localhost:3000
# prints https://<random>.trycloudflare.com — valid CA-issued TLS
```

Caveats: URL changes every restart; first visit shows Cloudflare's
"TOUCH TO PROCEED" interstitial → **not World-App-usable**; no access control.
Use only to prove the https-from-outside path.

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
