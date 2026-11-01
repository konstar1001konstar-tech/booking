'use strict';

const DEFAULT_LIMITS = {
  ip: { windowMs: 10 * 60 * 1000, limit: 10 },
  phone: { windowMs: 60 * 60 * 1000, limit: 5 }
};

function windowStart(nowMs, windowMs) {
  return String(Math.floor(nowMs / windowMs) * windowMs);
}

async function tooMany(repo, bucket, rule, nowMs) {
  const start = windowStart(nowMs, rule.windowMs);
  const count = await repo.addRate(bucket, start);
  return count > rule.limit;
}

module.exports = { DEFAULT_LIMITS, windowStart, tooMany };
