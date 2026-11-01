'use strict';

async function callTelegram(token, method, body) {
  const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error('telegram');
    err.code = 'telegram';
    err.status = res.status;
    throw err;
  }
  return data;
}

function createTelegram(getToken) {
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
      return callTelegram(token, 'sendMessage', body);
    },
    async answerCallbackQuery(id, text) {
      const token = getToken();
      if (!token || !id) return null;
      return callTelegram(token, 'answerCallbackQuery', { callback_query_id: id, text: text || '' });
    },
    async editMessageReplyMarkup(chatId, messageId) {
      const token = getToken();
      if (!token || !messageId) return null;
      return callTelegram(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
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
      });
    }
  };
}

module.exports = { createTelegram };
