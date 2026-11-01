'use strict';

const { createHandler } = require('./src/handler');
const { createTelegram } = require('./src/telegram');

let appHandler;

function buildRepo() {
  // STORAGE=s3 (по умолчанию) — Object Storage; STORAGE=ydb — прежний YDB-репозиторий.
  const kind = (process.env.STORAGE || 's3').toLowerCase();
  if (kind === 'ydb') {
    const { YdbRepo } = require('./src/repo/ydb');
    return new YdbRepo();
  }
  const { S3Repo } = require('./src/repo/s3');
  const { MetadataTokenService } = require('./src/repo/metadata-token');
  const tokens = new MetadataTokenService();
  return new S3Repo({
    bucket: process.env.S3_BUCKET,
    endpoint: process.env.S3_ENDPOINT || undefined,
    getToken: async () => {
      const cached = tokens.getToken();
      if (cached) return cached;
      await tokens.initialize();
      return tokens.getToken();
    }
  });
}

function buildHandler() {
  const secrets = {
    botToken: process.env.BOT_TOKEN || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    // Необязательный отдельный ключ для хэшей в счётчиках защиты от спама;
    // без него ключ выводится из SESSION_SECRET.
    rateSecret: process.env.RATE_SECRET || ''
  };
  const flag = String(process.env.ALLOW_TELEGRAM_LOGIN || 'true').trim().toLowerCase();
  return createHandler({
    repo: buildRepo(),
    telegram: createTelegram(() => secrets.botToken, {
      relayUrl: process.env.RELAY_URL || '',
      relayKey: process.env.RELAY_KEY || '',
      relayIps: process.env.RELAY_IPS || ''
    }),
    secrets,
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    secureCookie: process.env.COOKIE_SECURE !== '0',
    setWebhook: process.env.SET_WEBHOOK === '1',
    webhookUrl: (process.env.WEBHOOK_URL || '').trim(),
    allowTelegramLogin: !['0', 'false', 'no', 'off'].includes(flag),
    oauth: {
      yandex: { clientId: process.env.YANDEX_CLIENT_ID || '', clientSecret: process.env.YANDEX_CLIENT_SECRET || '' },
      vkid: { clientId: process.env.VKID_CLIENT_ID || '', clientSecret: process.env.VKID_CLIENT_SECRET || '' }
    },
    owner: {
      fio: process.env.OWNER_FIO || '',
      inn: process.env.OWNER_INN || '',
      email: process.env.OWNER_EMAIL || ''
    },
    botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, '').trim(),
    retentionMonths: Number(process.env.RETENTION_MONTHS || 12)
  });
}

module.exports.handler = async function handler(event) {
  // Note: the cache must not be named `handler` - the named function expression
  // would shadow it and recurse forever.
  if (event && event.diag === 'relay' && !event.httpMethod && !event.requestContext) {
    return require('./src/diag').relayDiag(process.env.RELAY_URL || 'https://booking-dun-beta.vercel.app/api/tg', event);
  }
  if (!appHandler) appHandler = buildHandler();
  return appHandler(event);
};
