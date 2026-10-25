'use strict';

// Tracks progress for the daily "Home Server" lesson emails.
// The Claude routine reports which lesson it sent; the user taps a link in the
// email to mark it done. All routes require ?key=LESSON_KEY.

const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const express = require('express');

const { LESSON_KEY, LESSON_DATA_DIR = path.join(__dirname, 'data') } = process.env;
const STATE_FILE = path.join(LESSON_DATA_DIR, 'lessons.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { sent: 0, done: 0 };
  }
}

function writeState(state) {
  fs.mkdirSync(LESSON_DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, updated: new Date().toISOString() }));
}

function requireLessonKey(req, res, next) {
  if (!LESSON_KEY) return res.status(503).json({ ok: false, message: 'Lessons not configured' });
  const provided = Buffer.from(String(req.query.key ?? ''));
  const expected = Buffer.from(LESSON_KEY);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, message: 'Invalid key' });
  }
  next();
}

function lessonNumber(req) {
  const n = Number(req.query.n);
  return Number.isInteger(n) && n >= 0 && n < 10000 ? n : null;
}

const router = express.Router();
router.use(requireLessonKey);

// Routine: read progress before choosing tonight's lesson
router.get('/progress', (_req, res) => {
  res.json({ ok: true, ...readState() });
});

// Routine: record that lesson n was emailed
router.get('/sent', (req, res) => {
  const n = lessonNumber(req);
  if (n === null) return res.status(400).json({ ok: false, message: 'n must be a lesson number' });
  const state = readState();
  writeState({ ...state, sent: Math.max(state.sent, n) });
  res.json({ ok: true, ...readState() });
});

// User: tap "Done" link in the email (opened in a phone browser)
router.get('/done', (req, res) => {
  const n = lessonNumber(req);
  if (n === null) return res.status(400).send('Bad lesson number');
  const state = readState();
  writeState({ ...state, done: Math.max(state.done, n) });
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:48px 16px">
<h2>&#9989; Lesson ${n} done</h2><p>The next lesson arrives tonight at 8 PM.</p></body>`);
});

module.exports = { lessonsRouter: router };
