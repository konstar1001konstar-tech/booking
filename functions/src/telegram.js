'use strict';

const DIRECT_BASE = 'https://api.telegram.org';

// Если задан RELAY_URL (например https://booking-dun-beta.vercel.app/api/tg),
// запросы идут через релей: токен — в X-Bot-Token, ключ релея — в X-Relay-Key.
// Иначе — напрямую в api.telegram.org.
function telegramRequest(token, method, body, relay) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(7000);
  if (relay && relay.relayUrl) {
    init.headers['X-Bot-Token'] = token;
    init.headers['X-Relay-Key'] = relay.relayKey || '';
    return { url: relay.relayUrl.replace(/\/$/, '') + '/' + method, init };
  }
  return { url: DIRECT_BASE + '/bot' + token + '/' + method, init };
}

async function callTelegram(token, method, body, relay) {
  const req = telegramRequest(token, method, body, relay);
  const res = await (relay && relay.fetch ? relay.fetch : fetch)(req.url, req.init);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error('telegram');
    err.code = 'telegram';
    err.status = res.status;
    throw err;
  }
  return data;
}

function createTelegram(getToken, relayOptions) {
  const relay = relayOptions || null;
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
      return callTelegram(token, 'sendMessage', body, relay);
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
      }, relay);
    }
  };
}

module.exports = { createTelegram, telegramRequest };
