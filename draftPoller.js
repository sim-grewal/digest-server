'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { extractUrls, saveToInstapaper } = require('./instapaper');
const { htmlToText, generateMp3 } = require('./tts');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));
}

// Step 1: Connect to IMAP, fetch all draft sources, delete them, disconnect.
// Kept fast — no slow operations while IMAP is open.
async function fetchAndDeleteDrafts() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });

  // Surface IMAP errors into the promise chain instead of as uncaught exceptions
  const errorPromise = new Promise((_, reject) => client.once('error', reject));

  await Promise.race([client.connect(), errorPromise]);

  const mailboxes = await client.list();
  const draftsBox = mailboxes.find(m => m.specialUse === '\\Drafts' || m.name === 'Drafts');

  if (!draftsBox) {
    await client.logout();
    return [];
  }

  const lock = await client.getMailboxLock(draftsBox.path);
  const sources = [];
  const uids = [];

  try {
    for await (const msg of client.fetch('1:*', { source: true, uid: true })) {
      sources.push(msg.source);
      uids.push(msg.uid);
    }
    if (uids.length) {
      await client.messageDelete(uids, { uid: true });
    }
  } finally {
    lock.release();
  }

  await client.logout();
  return sources;
}

// Step 2: Parse, generate audio if needed, and send — all after IMAP is closed.
async function processDrafts(sources) {
  const transport = createTransport();

  for (const source of sources) {
    try {
      const parsed = await simpleParser(source);
      const rawSubject = parsed.subject || '(no subject)';
      const isAudio = /\[AUDIO\]/i.test(rawSubject);
      const cleanSubject = rawSubject.replace(/\[AUDIO\]\s*/i, '').trim();
      const draftTo = parsed.to?.text || process.env.RECIPIENT_EMAIL;

      if (isAudio && process.env.OPENAI_TTS_API_KEY) {
        try {
          const plainText = htmlToText(parsed.html || parsed.text || '');
          const mp3 = await generateMp3(plainText, process.env.OPENAI_TTS_API_KEY);
          const filename = cleanSubject.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) + '.mp3';
          await transport.sendMail({
            from:        `"Cowork Digest" <${process.env.SMTP_USER}>`,
            to:          draftTo,
            subject:     `🎧 ${cleanSubject}`,
            text:        'Audio digest attached.',
            attachments: [{ filename, content: mp3, contentType: 'audio/mpeg' }],
          });
          log('POLLER_SENT', { subject: cleanSubject, audio: true, bytes: mp3.length });
        } catch (ttsErr) {
          log('POLLER_TTS_ERROR', { error: ttsErr.message });
        }
      } else {
        await transport.sendMail({
          from:    `"Cowork Digest" <${process.env.SMTP_USER}>`,
          to:      draftTo,
          subject: cleanSubject,
          html:    parsed.html || parsed.textAsHtml || '',
          text:    parsed.text || '',
        });
        log('POLLER_SENT', { subject: cleanSubject, audio: false });
      }

      if (process.env.INSTAPAPER_USERNAME && parsed.html) {
        const urls = extractUrls(parsed.html);
        if (urls.length) {
          const results = await saveToInstapaper(urls, process.env.INSTAPAPER_USERNAME, process.env.INSTAPAPER_PASSWORD);
          log('POLLER_INSTAPAPER', { subject: cleanSubject, urls_found: urls.length, saved: results.filter(r => r.ok).length });
        }
      }
    } catch (err) {
      log('POLLER_SEND_ERROR', { error: err.message });
    }
  }
}

async function pollDrafts() {
  log('POLLER_POLL');
  try {
    const sources = await fetchAndDeleteDrafts();
    if (sources.length === 0) {
      log('POLLER_NO_DRAFTS');
      return;
    }
    log('POLLER_FOUND', { count: sources.length });
    await processDrafts(sources);
    log('POLLER_DONE', { count: sources.length });
  } catch (err) {
    log('POLLER_ERROR', { error: err.message });
  }
}

function startPoller() {
  log('POLLER_STARTED', { interval_minutes: POLL_INTERVAL_MS / 60000 });
  pollDrafts();
  setInterval(pollDrafts, POLL_INTERVAL_MS);
}

module.exports = { startPoller };
