'use strict';

const crypto = require('crypto');

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const LOGIN_MS = 10 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}

function verify(token, secret, nowMs) {
  if (!secret) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!json || typeof json !== 'object') return null;
    const now = nowMs == null ? Date.now() : nowMs;
    if (json.exp && now > json.exp) return null;
    return json;
  } catch (e) {
    return null;
  }
}

function randomId(bytes) {
  return crypto.randomBytes(bytes || 9).toString('base64url');
}

function cookie(name, value, options) {
  const opts = options || {};
  const parts = [
    name + '=' + value,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + (opts.maxAge == null ? 0 : opts.maxAge)
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(header, name) {
  const raw = String(header || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return '';
}

module.exports = {
  SESSION_MS,
  LOGIN_MS,
  safeEqual,
  sign,
  verify,
  randomId,
  cookie,
  readCookie
};
