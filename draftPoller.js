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

async function pollDrafts() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
  });

  try {
    await client.connect();

    // Find Drafts mailbox by special-use attribute
    const mailboxes = await client.list();
    const draftsBox = mailboxes.find(m =>
      m.specialUse === '\\Drafts' || m.name === 'Drafts'
    );

    if (!draftsBox) {
      log('POLLER_NO_DRAFTS_FOLDER');
      await client.logout();
      return;
    }

    const lock = await client.getMailboxLock(draftsBox.path);
    const toDelete = [];

    try {
      const transport = createTransport();
      let count = 0;

      for await (const msg of client.fetch('1:*', { source: true, envelope: true, uid: true })) {
        count++;
        try {
          const parsed = await simpleParser(msg.source);

          // Generate TTS audio attachment if configured
          let attachments = [];
          if (process.env.GOOGLE_TTS_API_KEY) {
            try {
              const plainText = htmlToText(parsed.html || parsed.text || '');
              const mp3 = await generateMp3(plainText, process.env.GOOGLE_TTS_API_KEY);
              const subject = parsed.subject || 'digest';
              const filename = subject.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) + '.mp3';
              attachments = [{ filename, content: mp3, contentType: 'audio/mpeg' }];
              log('POLLER_TTS_OK', { bytes: mp3.length });
            } catch (ttsErr) {
              log('POLLER_TTS_ERROR', { error: ttsErr.message });
            }
          }

          const draftTo = parsed.to?.text || msg.envelope?.to?.map(a => a.address).join(', ');
          await transport.sendMail({
            from:        `"Cowork Digest" <${process.env.SMTP_USER}>`,
            to:          draftTo || process.env.RECIPIENT_EMAIL,
            subject:     parsed.subject || msg.envelope?.subject || '(no subject)',
            html:        parsed.html || parsed.textAsHtml || '',
            text:        parsed.text || '',
            attachments,
          });

          log('POLLER_SENT', { subject: parsed.subject, audio: attachments.length > 0 });

          if (process.env.INSTAPAPER_USERNAME) {
            const urls = extractUrls(parsed.html);
            if (urls.length) {
              const results = await saveToInstapaper(urls, process.env.INSTAPAPER_USERNAME, process.env.INSTAPAPER_PASSWORD);
              const saved = results.filter(r => r.ok).length;
              log('POLLER_INSTAPAPER', { subject: parsed.subject, urls_found: urls.length, saved });
            }
          }

          toDelete.push(msg.uid);
        } catch (err) {
          log('POLLER_SEND_ERROR', { uid: msg.uid, error: err.message });
        }
      }

      if (count === 0) {
        log('POLLER_NO_DRAFTS');
      }

      // Delete sent drafts
      if (toDelete.length) {
        await client.messageDelete(toDelete, { uid: true });
        log('POLLER_DRAFTS_DELETED', { count: toDelete.length });
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    log('POLLER_ERROR', { error: err.message });
    try { await client.logout(); } catch {}
  }
}

function startPoller() {
  log('POLLER_STARTED', { interval_minutes: POLL_INTERVAL_MS / 60000 });
  pollDrafts();
  setInterval(pollDrafts, POLL_INTERVAL_MS);
}

module.exports = { startPoller };
