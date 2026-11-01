'use strict';

const { createHandler } = require('./src/handler');
const { YdbRepo } = require('./src/repo/ydb');
const { createTelegram } = require('./src/telegram');

let handler;

function buildHandler() {
  const secrets = {
    botToken: process.env.BOT_TOKEN || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    webhookSecret: process.env.WEBHOOK_SECRET || ''
  };
  return createHandler({
    repo: new YdbRepo(),
    telegram: createTelegram(() => secrets.botToken),
    secrets,
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    secureCookie: process.env.COOKIE_SECURE !== '0',
    setWebhook: process.env.SET_WEBHOOK === '1'
  });
}

module.exports.handler = async function handler(event) {
  if (!handler) handler = buildHandler();
  return handler(event);
};
