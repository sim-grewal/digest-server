'use strict';

require('dotenv').config();

const crypto     = require('crypto');
const express    = require('express');
const rateLimit  = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { buildEmailHtml } = require('./emailTemplate');
const { startPoller } = require('./draftPoller');

// ── Config ────────────────────────────────────────────────────────────────────

const {
  PORT           = 3000,
  API_KEY,
  SMTP_HOST,
  SMTP_PORT      = 587,
  SMTP_USER,
  SMTP_PASS,
  RECIPIENT_EMAIL,
  NODE_ENV,
} = process.env;

if (!API_KEY || !SMTP_HOST || !SMTP_USER || !SMTP_PASS || !RECIPIENT_EMAIL) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

const API_KEY_BUF = Buffer.from(API_KEY);

// ── Nodemailer transport ──────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Enforce HTTPS in production
if (NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.status(400).json({ ok: false, message: 'HTTPS required' });
    }
    next();
  });
}

// Rate limiting — 20 requests per hour per IP
app.use(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: 'Too many requests, try again later' },
  })
);

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'];
  if (!provided) {
    return res.status(401).json({ ok: false, message: 'Missing X-API-Key header' });
  }

  const providedBuf = Buffer.from(provided);

  // Constant-time comparison to prevent timing attacks
  if (
    providedBuf.length !== API_KEY_BUF.length ||
    !crypto.timingSafeEqual(providedBuf, API_KEY_BUF)
  ) {
    log('AUTH_FAIL', req);
    return res.status(401).json({ ok: false, message: 'Invalid API key' });
  }

  next();
}

// ── Logging (no API key, no email content) ────────────────────────────────────

function log(event, req, extra = {}) {
  const entry = {
    ts:    new Date().toISOString(),
    event,
    ip:    req.ip,
    type:  req.body?.type ?? null,
    ...extra,
  };
  console.log(JSON.stringify(entry));
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — no auth
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

// Digest endpoint
app.post('/digest', requireApiKey, async (req, res) => {
  const { subject, body, type } = req.body;

  if (!subject || !body) {
    log('VALIDATION_FAIL', req, { reason: 'missing fields' });
    return res.status(400).json({ ok: false, message: 'subject and body are required' });
  }

  const html = buildEmailHtml(subject, body, type);

  try {
    await transporter.sendMail({
      from:    `"Cowork Digest" <${SMTP_USER}>`,
      to:      RECIPIENT_EMAIL,
      subject,
      html,
    });

    log('SENT', req, { subject_length: subject.length });
    res.json({ ok: true, message: 'Digest sent successfully' });
  } catch (err) {
    log('SEND_FAIL', req, { error: err.message });
    res.status(500).json({ ok: false, message: `Email send failed: ${err.message}` });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}${'*'.repeat(local.length - 1)}@${domain}`;
}

app.listen(PORT, () => {
  console.log(`\nCowork Digest Server`);
  console.log(`  Listening on port : ${PORT}`);
  console.log(`  SMTP host         : ${SMTP_HOST}:${SMTP_PORT}`);
  console.log(`  Recipient         : ${maskEmail(RECIPIENT_EMAIL)}`);
  console.log(`  API key set       : ${API_KEY ? 'yes' : 'NO — server will reject all requests'}`);
  console.log(`  Environment       : ${NODE_ENV ?? 'development'}\n`);
  startPoller();
});
