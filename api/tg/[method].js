'use strict';

// Telegram Bot API relay for the Yandex Cloud function.
// POST /api/tg/<method>  ->  https://api.telegram.org/bot<X-Bot-Token>/<method>
// Access requires the X-Relay-Key header; only its SHA-256 hash is stored here.
// No dependencies, no logging of tokens or bodies.

const crypto = require('crypto');

const RELAY_KEY_SHA256 = 'dee3b46d76afa18d56673b120c03984b61c2712a90aaceef59d751e53cee8f92';
const METHOD_RE = /^[A-Za-z]+$/;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function keyOk(key) {
  if (typeof key !== 'string' || !key) return false;
  const got = crypto.createHash('sha256').update(key).digest();
  const want = Buffer.from(RELAY_KEY_SHA256, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function bodyOf(req) {
  let body;
  try {
    body = req.body;
  } catch (e) {
    body = undefined;
  }
  if (body === undefined || body === null) {
    const raw = await readRaw(req);
    return raw.length ? raw.toString('utf8') : '';
  }
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

module.exports = async function relay(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return send(res, 405, { ok: false, description: 'method not allowed' });
  }
  if (!keyOk(req.headers['x-relay-key'])) return send(res, 403, { ok: false, description: 'forbidden' });

  const token = String(req.headers['x-bot-token'] || '');
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token)) return send(res, 400, { ok: false, description: 'bad token' });

  let method = req.query && req.query.method;
  if (!method) {
    const path = String(req.url || '').split('?')[0];
    method = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  }
  if (Array.isArray(method)) method = method[0];
  if (!METHOD_RE.test(String(method || ''))) return send(res, 400, { ok: false, description: 'bad method' });

  try {
    const payload = req.method === 'POST' ? await bodyOf(req) : '';
    const upstream = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload || '{}',
      signal: AbortSignal.timeout(9000)
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(text);
  } catch (e) {
    return send(res, 502, { ok: false, description: 'relay upstream error' });
  }
};
