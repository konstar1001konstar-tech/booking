'use strict';

// Outbox для сообщений в Telegram. Сеть Yandex Cloud -> релей иногда не
// отвечает, поэтому: одна быстрая попытка при запросе; если не вышло —
// сообщение сохраняется в хранилище (data/outbox/<id>.json), а таймер раз в
// минуту вызывает функцию и досылает его (processOutbox).
//
// Запись outbox:
//   { id, kind: 'booking'|'message', chatId, text, options, bookingId,
//     createdAt, expiresAt, attempts, nextAt, lockedUntil, lastError }

const { randomId } = require('./lib/session');

const FAST_TIMEOUT_MS = 4000;
const RETRY_TIMEOUT_MS = 5000;
const BOOKING_TTL_MS = 24 * 3600 * 1000;
const MESSAGE_TTL_MS = 3600 * 1000;
const LOCK_MS = 60 * 1000;
const RUN_BUDGET_MS = 18000;
const BATCH = 5;

function nowMs(deps) {
  return (deps.now ? deps.now() : new Date()).getTime();
}

function hasOutbox(deps) {
  return Boolean(deps.repo && deps.repo.putOutbox && deps.repo.listOutbox);
}

function messageIdOf(sent) {
  return sent && sent.result && sent.result.message_id;
}

async function enqueue(deps, item) {
  if (!hasOutbox(deps)) return false;
  const now = nowMs(deps);
  const row = Object.assign({
    attempts: 1,
    nextAt: now,
    lockedUntil: 0,
    createdAt: new Date(now).toISOString()
  }, item);
  try {
    await deps.repo.putOutbox(row);
    return true;
  } catch (err) {
    console.error('outbox put failed');
    return false;
  }
}

// Быстрая отправка. Возвращает { sent, queued, messageId }.
async function sendOrQueue(deps, chatId, text, options, meta) {
  const m = meta || {};
  const opts = Object.assign({}, options || {}, { timeoutMs: m.timeoutMs || FAST_TIMEOUT_MS });
  try {
    const res = await deps.telegram.sendMessage(chatId, text, opts);
    return { sent: true, queued: false, messageId: messageIdOf(res) };
  } catch (err) {
    if (err && (err.permanent || err.code === 'no_token')) return { sent: false, queued: false };
    const now = nowMs(deps);
    const kind = m.bookingId ? 'booking' : 'message';
    const ttl = m.ttlMs || (kind === 'booking' ? BOOKING_TTL_MS : MESSAGE_TTL_MS);
    const queued = await enqueue(deps, {
      id: m.id || (m.bookingId ? 'b_' + m.bookingId : 'm_' + randomId(9)),
      kind,
      chatId: String(chatId),
      text,
      options: { parseMode: (options || {}).parseMode || '', replyMarkup: (options || {}).replyMarkup || null },
      bookingId: m.bookingId || '',
      expiresAt: now + ttl,
      lastError: String((err && err.code) || 'error')
    });
    return { sent: false, queued };
  }
}

function backoffMs(attempts) {
  // 1, 2, 4, 8 ... минут, не больше 30.
  return Math.min(30, Math.pow(2, Math.max(0, attempts - 1))) * 60 * 1000;
}

async function deliverOne(deps, row, now) {
  const item = row.value;
  if (item.expiresAt && now > item.expiresAt) {
    console.warn('outbox give up', item.kind, item.id, 'attempts', item.attempts);
    await deps.repo.deleteOutbox(item.id);
    return 'expired';
  }
  if ((item.nextAt || 0) > now || (item.lockedUntil || 0) > now) return 'later';
  if (item.kind === 'booking' && item.bookingId) {
    const booking = await deps.repo.getBooking(item.bookingId);
    // Заявку уже удалили или мастер увидел её в панели — слать нечего.
    if (!booking || booking.status !== 'pending' || booking.tgMessageId) {
      await deps.repo.deleteOutbox(item.id);
      return 'dropped';
    }
  }
  // Захват записи условной записью по ETag: два параллельных прогона таймера
  // не отправят одно сообщение дважды.
  const claimed = Object.assign({}, item, { lockedUntil: now + LOCK_MS, attempts: (item.attempts || 0) + 1 });
  const etag = await deps.repo.claimOutbox(item.id, claimed, row.etag);
  if (!etag) return 'busy';
  const opts = item.options || {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (nowMs(deps) - now > RUN_BUDGET_MS - RETRY_TIMEOUT_MS) break;
    try {
      const res = await deps.telegram.sendMessage(item.chatId, item.text, {
        parseMode: opts.parseMode || undefined,
        replyMarkup: opts.replyMarkup || undefined,
        timeoutMs: RETRY_TIMEOUT_MS
      });
      const messageId = messageIdOf(res);
      if (item.kind === 'booking' && item.bookingId && messageId) {
        await deps.repo.setMessageId(item.bookingId, messageId);
      }
      await deps.repo.deleteOutbox(item.id);
      return 'sent';
    } catch (err) {
      if (err && err.permanent) {
        console.warn('outbox permanent error', item.kind, item.id, err.status);
        await deps.repo.deleteOutbox(item.id);
        return 'failed';
      }
      claimed.lastError = String((err && err.code) || 'error');
    }
  }
  const after = Object.assign({}, claimed, { lockedUntil: 0, nextAt: nowMs(deps) + backoffMs(claimed.attempts) });
  await deps.repo.claimOutbox(item.id, after, etag);
  return 'retry';
}

async function processOutbox(deps) {
  const start = nowMs(deps);
  const stats = { total: 0, sent: 0, retry: 0, expired: 0, dropped: 0, failed: 0, later: 0, busy: 0 };
  if (!hasOutbox(deps)) return stats;
  const ids = await deps.repo.listOutbox();
  stats.total = ids.length;
  for (let i = 0; i < ids.length; i += BATCH) {
    if (nowMs(deps) - start > RUN_BUDGET_MS - RETRY_TIMEOUT_MS) break;
    const chunk = ids.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(async (id) => {
      try {
        const row = await deps.repo.getOutbox(id);
        if (!row) return 'dropped';
        return await deliverOne(deps, row, nowMs(deps));
      } catch (err) {
        console.error('outbox item error');
        return 'retry';
      }
    }));
    for (const r of results) stats[r] = (stats[r] || 0) + 1;
  }
  if (stats.total) console.log('outbox', JSON.stringify(stats));
  return stats;
}

function isTimerEvent(event) {
  const msgs = event && event.messages;
  if (!Array.isArray(msgs) || !msgs.length) return false;
  return msgs.some((m) => {
    const type = m && m.event_metadata && m.event_metadata.event_type;
    return typeof type === 'string' && /TimerMessage$/.test(type);
  });
}

module.exports = { sendOrQueue, processOutbox, isTimerEvent, backoffMs, FAST_TIMEOUT_MS };
