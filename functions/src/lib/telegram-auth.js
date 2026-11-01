'use strict';

const crypto = require('crypto');
const { safeEqual } = require('./session');

function checkTelegramLogin(data, botToken, nowMs, maxAgeSec) {
  if (!data || typeof data !== 'object' || !botToken) return null;
  const hash = data.hash;
  if (!hash || data.auth_date == null || data.id == null) return null;
  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return null;
  const maxAge = maxAgeSec == null ? 86400 : maxAgeSec;
  const now = (nowMs == null ? Date.now() : nowMs) / 1000;
  if (Math.abs(now - authDate) > maxAge) return null;
  const check = Object.keys(data)
    .filter((key) => key !== 'hash' && data[key] != null)
    .sort()
    .map((key) => key + '=' + data[key])
    .join('\n');
  const secret = crypto.createHash('sha256').update(String(botToken)).digest();
  const hmac = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!safeEqual(hmac, String(hash).toLowerCase())) return null;
  return {
    id: String(data.id),
    username: data.username ? String(data.username) : '',
    firstName: data.first_name ? String(data.first_name) : ''
  };
}

module.exports = { checkTelegramLogin };
