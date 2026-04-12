'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

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

          await transport.sendMail({
            from:    `"Cowork Digest" <${process.env.SMTP_USER}>`,
            to:      process.env.RECIPIENT_EMAIL,
            subject: parsed.subject || msg.envelope?.subject || '(no subject)',
            html:    parsed.html || parsed.textAsHtml || '',
            text:    parsed.text || '',
          });

          log('POLLER_SENT', { subject: parsed.subject });
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
