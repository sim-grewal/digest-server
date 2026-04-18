# Cowork Digest Server

Lightweight Node.js server that receives digest content via HTTP POST and forwards it as a formatted HTML email.

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
| `API_KEY` | Secret key the caller must send in `X-API-Key` header |
| `SMTP_HOST` | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port — `587` for TLS, `465` for SSL |
| `SMTP_USER` | Your Gmail address |
| `SMTP_PASS` | Gmail App Password (see below) |
| `RECIPIENT_EMAIL` | Where digests are delivered |
| `INSTAPAPER_USERNAME` | Instapaper email (optional — enables saving article URLs) |
| `INSTAPAPER_PASSWORD` | Instapaper password (leave blank if none set) |

### 3. Run the server

```bash
# Development
npm run dev

# Production
node server.js
```

---

## Gmail App Password

Gmail requires an **App Password** instead of your regular password when using SMTP:

1. Go to your Google Account → **Security**
2. Under "How you sign in to Google", enable **2-Step Verification** if not already on
3. Go to **Security → App passwords** (search "App passwords" in the Google Account search bar)
4. Click **Create app password** → choose a name (e.g. "Digest Server") → click **Create**
5. Copy the 16-character password and paste it into `SMTP_PASS` in your `.env`

> Your regular Gmail password will not work — you must use an App Password.

---

## Test the endpoint locally

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

Health check (no auth required):

```bash
curl http://localhost:3000/health
```

---

## Exposing the server to the internet

Your home server needs a public URL so Claude / Cowork can reach it. The easiest options:

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

[pm2](https://pm2.keymetrics.io/) keeps the server alive after you close the terminal and restarts it on crashes.

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

## Webhook payload format

```json
{
  "subject": "☀️ Your Morning Digest — Monday, April 13",
  "body": "<p>Digest content here (HTML or plain text)</p>",
  "type": "morning"
}
```

`type` controls the header colour: `morning` (orange), `coaching` (blue), `afternoon` (green).
