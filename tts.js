'use strict';

const https = require('https');

// Strip HTML tags and collapse whitespace for clean TTS input
function htmlToText(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Call Google Cloud TTS and return an MP3 Buffer
function generateMp3(text, apiKey) {
  // Google TTS max input is 5000 chars — truncate gracefully
  const input = text.slice(0, 4900);

  const body = JSON.stringify({
    input: { text: input },
    voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            const json = JSON.parse(raw);
            if (json.error) return reject(new Error(json.error.message));
            resolve(Buffer.from(json.audioContent, 'base64'));
          } catch (e) {
            reject(new Error(`TTS parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { htmlToText, generateMp3 };
