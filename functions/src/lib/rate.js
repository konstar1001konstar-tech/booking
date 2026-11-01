'use strict';

const crypto = require('crypto');

const DEFAULT_LIMITS = {
  ip: { windowMs: 10 * 60 * 1000, limit: 10 },
  phone: { windowMs: 60 * 60 * 1000, limit: 5 }
};

function windowStart(nowMs, windowMs) {
  return String(Math.floor(nowMs / windowMs) * windowMs);
}

// Телефон и IP не должны лежать в ключах счётчиков открытым текстом
// (data/rates/...). Ключ — HMAC-SHA256 от значения: секрет RATE_SECRET из
// Lockbox, а если его нет — производный от session_secret (тоже из Lockbox).
function rateKeySecret(secrets) {
  const s = secrets || {};
  if (s.rateSecret) return String(s.rateSecret);
  if (s.sessionSecret) {
    return crypto.createHmac('sha256', String(s.sessionSecret)).update('bl-rate-key-v1').digest('hex');
  }
  return '';
}

function hashPart(secret, value) {
  return crypto.createHmac('sha256', secret || 'bl-rate-unset').update(String(value)).digest('base64url').slice(0, 22);
}

async function tooMany(repo, bucket, rule, nowMs) {
  const start = windowStart(nowMs, rule.windowMs);
  const count = await repo.addRate(bucket, start);
  return count > rule.limit;
}

module.exports = { DEFAULT_LIMITS, windowStart, tooMany, rateKeySecret, hashPart };
