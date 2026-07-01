'use strict';

const INSTAPAPER_API = 'https://www.instapaper.com/api/add';

function extractUrls(html) {
  if (!html) return [];
  const seen = new Set();
  const urls = [];
  for (const [, url] of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

async function saveToInstapaper(urls, username, password) {
  const auth = Buffer.from(`${username}:${password ?? ''}`).toString('base64');
  const results = [];

  for (const url of urls) {
    try {
      const res = await fetch(INSTAPAPER_API, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ url }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      results.push({ url, ok: res.status === 201, status: res.status });
    } catch (err) {
      results.push({ url, ok: false, error: err.message });
    }
  }

  return results;
}

module.exports = { extractUrls, saveToInstapaper };
