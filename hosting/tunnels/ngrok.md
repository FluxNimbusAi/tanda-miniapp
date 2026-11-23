# ngrok staging tunnel — runbook (ADR-0009 Plan C, alt lane)

Fastest path to a public https URL; edge TLS is CA-issued (browser-trusted).
Free plan: random subdomain per restart + a browser "You are about to visit"
interstitial → desktop-only unless you claim the free static domain. Paid or
claimed `domain:` removes the interstitial for World App testing.

Boundary note: ngrok **requires an account for any tunnel** (authtoken). This
PR creates none; commands below run at staging time on a machine whose owner
has signed up.

## 0. Install

```bash
winget install --id ngrok.ngrok            # Windows
# brew install ngrok                       # macOS
ngrok version                              # expect 3.x (config schema version "3")
```

## 1. Auth (once per machine)

```bash
ngrok config add-authtoken <TOKEN>   # dashboard.ngrok.com -> Your Authtoken
# stores it in the ngrok.yml config file, not the repo. Never paste a real
# token into this repo — configs/ngrok.config.example.yml uses a placeholder.
```

Config file locations: Windows `%LOCALAPPDATA%\ngrok\ngrok.yml`,
Linux/macOS `~/.config/ngrok/ngrok.yml`.

## 2. Tunnel the standalone server

```bash
ngrok http 3000                     # one-off
# or named tunnel from the template:
ngrok --config hosting/tunnels/configs/ngrok.config.example.yml start tanda-staging
```

Stable hostname (World-App-usable): reserve a domain in the dashboard, then
uncomment `domain:` in the template and restart:

```bash
ngrok http 3000 --domain=tanda-staging.ngrok.app
```

## 3. Verify + inspect

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<your-ngrok-host>/   # 200
# local request inspector (off the LAN by default: inspect: addr)
http://127.0.0.1:4040/requesters
```

Config validation without starting anything:

```bash
ngrok config check --config hosting/tunnels/configs/ngrok.config.example.yml
# expect "valid configuration file" once placeholders are filled
```

## 4. Gotchas

- Free-plan interstitial breaks in-app webviews → for World App use
  cloudflared named tunnel or ngrok with a claimed/paid domain.
- Agent restarts rotate random hostnames → update `integration_url` again;
  prefer `domain:` for anything device-tested.
- `cidr_allowlist` in the template restricts ingress to known egress IPs —
  use it while the URL is provisional.

## 5. Teardown

Stop the process (`Ctrl-C` / `ngrok api` if run as service); no repo or host
state persists beyond the authtoken in the user-level config.
