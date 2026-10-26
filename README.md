# Cowork Digest Server

Home-server service that delivers your Cowork digests as email or audio, saves linked articles to Instapaper, and tracks progress on the Home Server daily lesson emails.

---

## How it actually works

Cowork's outbound sandbox proxy blocks direct webhook calls to this server, so digests don't arrive via the `/digest` HTTP endpoint — that endpoint exists but is currently **unused** (see [Legacy `/digest` endpoint](#legacy-digest-endpoint)). Instead:

1. Cowork creates a Gmail draft in the automation account's Drafts folder.
2. `draftPoller.js` polls that folder over IMAP every 5 minutes (`POLL_INTERVAL_MS` in `draftPoller.js`).
3. For each draft found:
   - If the subject contains `[AUDIO]`, `(AUDIO)`, or the bare word `AUDIO`, the body is converted to speech (see [Audio digests](#audio-digests)) and sent as an MP3 attachment instead of HTML.
   - Otherwise it's sent as a formatted HTML email via `emailTemplate.js`.
   - If `INSTAPAPER_USERNAME` is set, every `https://` link in the digest is saved to Instapaper (see [Instapaper integration](#instapaper-integration)).
   - The draft is deleted from Gmail only after a successful send.
4. Every step is logged as a JSON line to stdout (`POLLER_SENT`, `POLLER_ERROR`, `POLLER_SKIP`, `IMAP_WARN`, etc.) — `docker compose logs -f digest-server` to follow it live.

**Known tradeoff:** the send happens before the delete, to avoid losing a digest if the delete fails. If the IMAP delete fails, the same draft is still in the Drafts folder and gets resent on the next poll rather than silently dropped. If you see a duplicate digest, check the logs for `POLLER_ERROR` / `IMAP_ERROR` around that time.

---

## Setup

### 1. Install dependencies

```bash
cd digest-server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (default `3000`) |
| `NODE_ENV` | Set to `production` to require HTTPS on `/digest` (checks `X-Forwarded-Proto`). Leave unset for local dev. |
| `API_KEY` | Secret key the caller must send in `X-API-Key` header for `/digest` (unused endpoint — see above) |
| `SMTP_HOST` | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port — `587` for TLS, `465` for SSL |
| `SMTP_USER` | Your Gmail address — also the IMAP account `draftPoller.js` polls |
| `SMTP_PASS` | Gmail App Password (see below) |
| `RECIPIENT_EMAIL` | Fallback recipient if a draft has no `To:` address |
| `INSTAPAPER_USERNAME` | Instapaper email (optional — enables saving article URLs) |
| `INSTAPAPER_PASSWORD` | Instapaper password (leave blank if none set) |
| `OPENAI_TTS_API_KEY` | OpenAI key for `[AUDIO]` drafts (optional — falls back to local Kokoro, see [Audio digests](#audio-digests)) |
| `LESSON_KEY` | Secret for the `/lesson/*` progress routes (optional; routes return 503 without it) |

### 3. Run the server

```bash
# Development
npm run dev

# Production
node server.js
```

The draft poller starts automatically with the server — there's nothing separate to run.

---

## Gmail App Password

Gmail requires an **App Password** instead of your regular password for both SMTP (sending) and IMAP (the draft poller):

1. Go to your Google Account → **Security**
2. Under "How you sign in to Google", enable **2-Step Verification** if not already on
3. Go to **Security → App passwords** (search "App passwords" in the Google Account search bar)
4. Click **Create app password** → choose a name (e.g. "Digest Server") → click **Create**
5. Copy the 16-character password and paste it into `SMTP_PASS` in your `.env`

> Your regular Gmail password will not work — you must use an App Password.

---

## Audio digests

Tag a draft's subject with `[AUDIO]`, `(AUDIO)`, or the bare word `AUDIO` to get an MP3 attachment instead of an HTML email. The body is stripped of HTML, chunked, and synthesized with:

- **OpenAI TTS** (`tts-1-hd`) if `OPENAI_TTS_API_KEY` is set
- **Local Kokoro** (free) otherwise, via the `kokoro` container in `docker-compose.yml`

The local Kokoro path only works when running through `docker compose` — `tts.js` reaches it at the Compose-network hostname `http://kokoro:8880`, which doesn't resolve outside that network. If you run the server standalone (e.g. with pm2, below), set `OPENAI_TTS_API_KEY` or audio digests will fail.

---

## Test the endpoint locally

Health check (no auth required):

```bash
curl http://localhost:3000/health
```

To actually test the real flow, create a draft in the Drafts folder of the account configured in `SMTP_USER`/`SMTP_PASS` and wait for the next poll (or restart the server to trigger an immediate one).

---

## Exposing the server to the internet

Your home server needs a public URL for the `/lesson/*` links in emails to work from your phone. The easiest options:

### Cloudflare Tunnel (recommended — free, no port forwarding)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Authenticate (one-time)
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create digest-server

# Start the tunnel (replace YOUR-TUNNEL-ID)
cloudflared tunnel run --url http://localhost:3000 YOUR-TUNNEL-ID
```

Or use the quick one-liner for testing (no account needed):

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://xxxx.trycloudflare.com` URL you can use immediately.

### Tailscale (if you already use it)

Enable Tailscale Funnel to expose a local port:

```bash
tailscale funnel 3000
```

### ngrok (simple alternative)

```bash
brew install ngrok
ngrok http 3000
```

---

## Running as a background service with pm2

[pm2](https://pm2.keymetrics.io/) keeps the server alive after you close the terminal and restarts it on crashes. **Note:** running this way means local Kokoro TTS won't work (see [Audio digests](#audio-digests)) — set `OPENAI_TTS_API_KEY` if you need `[AUDIO]` drafts without Docker.

```bash
# Install pm2 globally
npm install -g pm2

# Start the server
pm2 start server.js --name digest-server

# Auto-start on system reboot
pm2 startup
pm2 save

# Useful commands
pm2 status              # check running processes
pm2 logs digest-server  # tail logs
pm2 restart digest-server
pm2 stop digest-server
```

---

## Instapaper integration

When `INSTAPAPER_USERNAME` is set, the draft poller automatically extracts all `https://` links from each digest and saves them to your Instapaper account via the [Simple API](https://www.instapaper.com/api/simple).

Each sent digest logs a `POLLER_INSTAPAPER` event with `urls_found` and `saved` counts. If Instapaper is not configured, nothing changes.

---

## Lesson progress

Tracks the daily "Home Server" lesson emails sent by a Claude routine. All routes are `GET` and require `?key=LESSON_KEY`.

| Route | Called by | Effect |
|---|---|---|
| `/lesson/progress` | Routine, before choosing a lesson | Returns `{ sent, done }` |
| `/lesson/sent?n=N` | Routine, after emailing lesson N | Sets `sent` to N |
| `/lesson/done?n=N` | You, via the link in the email | Sets `done` to N, shows a confirmation page |

State is a small JSON file in the `lesson-data` Docker volume (`/data/lessons.json`), written atomically and serialized against concurrent requests.

**Known limitation:** `/sent` and `/done` are `GET` requests with side effects, since `/done` has to work as a plain link tapped from an email. Updates are idempotent (repeating a call is harmless), but if this email ever passes through a link-prefetching security scanner, a lesson could get marked done before you read it.

---

## Legacy `/digest` endpoint

A direct webhook endpoint exists but **nothing currently calls it** — Cowork's sandbox proxy can't reach it directly, hence the draft-poller flow described above. Kept in case a future caller can reach it directly.

```bash
curl -X POST http://localhost:3000/digest \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_secret_key_here" \
  -d '{
    "subject": "Test Digest",
    "body": "<p>Hello! This is a test digest.</p>",
    "type": "morning"
  }'
```

Payload format:

```json
{
  "subject": "☀️ Your Morning Digest — Monday, April 13",
  "body": "<p>Digest content here (HTML or plain text)</p>",
  "type": "morning"
}
```

`type` controls the header colour: `morning` (orange), `coaching` (blue), `afternoon` (green). Rate-limited to 20 requests/hour/IP.
