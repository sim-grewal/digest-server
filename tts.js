'use strict';

const https = require('https');

const CHUNK_SIZE = 4000;

// Strip HTML tags and collapse whitespace for clean TTS input
function htmlToText(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '...')
    .replace(/&#\d+;/g, '')
    .replace(/&\w+;/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Split text into chunks at sentence boundaries, each under CHUNK_SIZE chars
function splitIntoChunks(text) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > CHUNK_SIZE) {
    // Find the last sentence boundary (. ! ?) before the limit
    let splitAt = remaining.lastIndexOf('.', CHUNK_SIZE);
    const excl = remaining.lastIndexOf('!', CHUNK_SIZE);
    const ques = remaining.lastIndexOf('?', CHUNK_SIZE);
    splitAt = Math.max(splitAt, excl, ques);

    if (splitAt <= 0) {
      // No sentence boundary found — split at last space
      splitAt = remaining.lastIndexOf(' ', CHUNK_SIZE);
    }
    if (splitAt <= 0) splitAt = CHUNK_SIZE;

    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// Call OpenAI TTS for a single chunk and return an MP3 Buffer
function synthesizeChunk(text, apiKey) {
  const body = JSON.stringify({
    model: 'tts-1-hd',
    input: text,
    voice: 'alloy',
    response_format: 'mp3',
    speed: 1.0,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.openai.com/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 60000, // 60s per chunk
      },
      (res) => {
        if (res.statusCode !== 200) {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => reject(new Error(`OpenAI TTS ${res.statusCode}: ${Buffer.concat(chunks).toString()}`)));
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI TTS request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Generate full MP3 for arbitrarily long text by chunking and concatenating
async function generateMp3(text, apiKey) {
  const chunks = splitIntoChunks(text);
  const buffers = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(chunk, apiKey));
  }
  // MP3 frames are self-contained — concatenation produces valid audio
  return Buffer.concat(buffers);
}

module.exports = { htmlToText, generateMp3 };
