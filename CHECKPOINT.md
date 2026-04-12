# Checkpoint — 2026-04-12

## What was done this session

- Built `server.js` — Express server with `/digest` POST endpoint and `/health` GET endpoint
- Built `emailTemplate.js` — HTML email wrapper with colour-coded header banner (morning/coaching/afternoon)
- Built `draftPoller.js` — IMAP poller that reads Gmail Drafts every 5 minutes, forwards to recipient, deletes draft
- Added `Dockerfile`, `docker-compose.yml`, `.dockerignore` for home server deployment
- Created `.env` with real credentials (SMTP, API key, recipient)
- Created `.env.example` and `README.md`
- Created GitHub repo: https://github.com/ostringed/digest-server
- Added `digest.whereveriamayroam.xyz` → localhost:3000 in Cloudflare Tunnel (Zero Trust dashboard + config.yml)
- Set up porcupineautomations@gmail.com as dedicated automation Gmail account
- Generated Gmail App Password for SMTP; verified SMTP connection works
- Tested `/digest` endpoint end-to-end — email delivered to simranveer@gmail.com ✓
- Tested draft poller end-to-end — fetched Cowork draft, sent to inbox, deleted draft ✓

## Current state

- Code is complete and pushed to GitHub (main branch, up to date)
- Local `.env` is configured and working
- Cloudflare subdomain `digest.whereveriamayroam.xyz` is live
- **Home server deployment is pending** — user needs to `git pull` and `docker compose up -d --build` on home server
- Draft poller runs on startup, polls every 5 minutes

## Known gaps / TODO

1. **Deploy on home server** — `git clone` / `git pull` + copy `.env` + `docker compose up -d --build`
2. **Cowork sandbox allowlist** — Cowork's outbound proxy blocked direct calls to `digest.whereveriamayroam.xyz`; workaround is the draft poller flow (Cowork → Gmail draft → poller sends it). No action needed unless direct webhook is preferred.
3. **Poll interval** — currently 5 minutes; adjust `POLL_INTERVAL_MS` in `draftPoller.js` if needed

## How to resume

On home server (SSH as `sim`):
```bash
git clone git@github.com:ostringed/digest-server.git
cd digest-server
cp .env.example .env   # fill in values from 1Password
docker compose up -d
```

`.env` values needed:
- `API_KEY` — in 1Password
- `SMTP_USER` — porcupineautomations@gmail.com
- `SMTP_PASS` — Gmail App Password (in 1Password, "Home Server - Digest")
- `RECIPIENT_EMAIL` — simranveer@gmail.com
