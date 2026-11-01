'use strict';

const https = require('https');

const DIRECT_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 4000;

// Если задан RELAY_URL (например https://booking-dun-beta.vercel.app/api/tg),
// запросы идут через релей: токен — в X-Bot-Token, ключ релея — в X-Relay-Key.
// Иначе — напрямую в api.telegram.org.
function telegramRequest(token, method, body, relay) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  if (relay && relay.relayUrl) {
    init.headers['X-Bot-Token'] = token;
    init.headers['X-Relay-Key'] = relay.relayKey || '';
    return { url: relay.relayUrl.replace(/\/$/, '') + '/' + method, init };
  }
  return { url: DIRECT_BASE + '/bot' + token + '/' + method, init };
}

function parseIps(value) {
  return String(value || '').split(/[\s,]+/).filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
}

// Из Yandex Cloud новые адреса Vercel (216.198.79.0/24, 64.29.17.0/24) часто
// не отвечают: SYN теряется или зависает TLS-рукопожатие. Старый anycast-адрес
// Vercel 76.76.21.21 обслуживает те же проекты и отвечает стабильно. Поэтому к
// релею можно подключаться по заданным IP (RELAY_IPS), сохраняя имя хоста для
// SNI, проверки сертификата и заголовка Host. Свежее соединение на каждый
// запрос: между вызовами функция замораживается, keep-alive сокеты умирают.
function pinnedFetch(ips) {
  let next = 0;
  return function fetchPinned(url, init) {
    const u = new URL(url);
    const ip = ips[next % ips.length];
    next += 1;
    const opts = init || {};
    return new Promise((resolve, reject) => {
      const req = https.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: Object.assign({}, opts.headers || {}, { Connection: 'close' }),
        agent: false,
        lookup: (host, lookupOpts, cb) => {
          if (lookupOpts && lookupOpts.all) cb(null, [{ address: ip, family: 4 }]);
          else cb(null, ip, 4);
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: async () => JSON.parse(text),
            text: async () => text
          });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (opts.signal) {
        if (opts.signal.aborted) req.destroy(opts.signal.reason || new Error('aborted'));
        else opts.signal.addEventListener('abort', () => req.destroy(opts.signal.reason || new Error('aborted')), { once: true });
      }
      if (opts.body) req.write(opts.body);
      req.end();
    });
  };
}

function pickFetch(relay) {
  if (relay && relay.fetch) return relay.fetch;
  if (relay && relay.relayUrl && relay.relayIps && relay.relayIps.length) {
    if (!relay._pinned) relay._pinned = pinnedFetch(relay.relayIps);
    return relay._pinned;
  }
  return fetch;
}

// Одна попытка с коротким таймаутом. Повторы делает outbox (см. outbox.js),
// чтобы клиент не ждал, пока сеть до релея «отвиснет».
async function callTelegram(token, method, body, relay, timeoutMs) {
  const req = telegramRequest(token, method, body, relay);
  const init = Object.assign({}, req.init);
  const ms = timeoutMs || (relay && relay.timeoutMs) || DEFAULT_TIMEOUT_MS;
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(ms);
  let res;
  try {
    res = await pickFetch(relay)(req.url, init);
  } catch (cause) {
    const err = new Error('telegram network');
    err.code = 'network';
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error('telegram');
    err.code = 'telegram';
    err.status = res.status;
    // 400/403 от самого Telegram (чат не найден, бот заблокирован) повторять бесполезно.
    err.permanent = (res.status === 400 || res.status === 403) && data.ok === false && typeof data.error_code === 'number';
    throw err;
  }
  return data;
}

function createTelegram(getToken, relayOptions) {
  const relay = relayOptions ? Object.assign({}, relayOptions) : null;
  if (relay && typeof relay.relayIps === 'string') relay.relayIps = parseIps(relay.relayIps);
  return {
    async sendMessage(chatId, text, options) {
      const token = getToken();
      if (!token) {
        const err = new Error('no token');
        err.code = 'no_token';
        throw err;
      }
      const opts = options || {};
      const body = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      };
      if (opts.parseMode) body.parse_mode = opts.parseMode;
      if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
      return callTelegram(token, 'sendMessage', body, relay, opts.timeoutMs);
    },
    async answerCallbackQuery(id, text) {
      const token = getToken();
      if (!token || !id) return null;
      return callTelegram(token, 'answerCallbackQuery', { callback_query_id: id, text: text || '' }, relay);
    },
    async editMessageReplyMarkup(chatId, messageId) {
      const token = getToken();
      if (!token || !messageId) return null;
      return callTelegram(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      }, relay);
    },
    async setWebhook(url, secret) {
      const token = getToken();
      if (!token) {
        const err = new Error('no token');
        err.code = 'no_token';
        throw err;
      }
      return callTelegram(token, 'setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query']
      }, relay, 8000);
    }
  };
}

module.exports = { createTelegram, telegramRequest, pinnedFetch, parseIps };
