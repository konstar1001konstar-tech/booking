'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandler } = require('../functions/src/handler');
const { MemoryRepo } = require('../functions/src/repo/memory');
const { issueLoginToken } = require('../functions/src/service');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const SECRETS = {
  botToken: 'local-test-token',
  sessionSecret: 'local-session-secret',
  webhookSecret: 'local-webhook-secret'
};

const FILES = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/calendar.js': ['calendar.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['favicon.ico', 'image/x-icon'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/site.webmanifest': ['site.webmanifest', 'application/manifest+json'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8']
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function seed(repo) {
  const now = new Date().toISOString();
  await repo.insertMaster({
    slug: 'anna',
    chatId: '1001',
    telegramUserId: '1001',
    published: true,
    createdAt: now,
    updatedAt: now,
    profile: {
      name: 'Анна | Маникюр',
      desc: 'Аккуратно, стерильно, без спешки',
      photo: '',
      addr: 'ул. Малая Бронная, 12, студия 204',
      hint: 'Вход со двора, 2 этаж, домофон 204',
      services: [
        { name: 'Комбинированный маникюр', price: 1500, dur: '1,5 ч' },
        { name: 'Маникюр и гель-лак', price: 2200, dur: '2 ч' }
      ],
      slots: ['10:00', '12:30', '15:00', '18:00'],
      gallery: [],
      tz: 'Europe/Moscow',
      workDays: [0, 1, 2, 3, 4, 5, 6],
      horizon: 14,
      category: 'manicure',
      theme: 'plum',
      legalName: 'Анна Иванова',
      legalStatus: 'self',
      inn: '',
      revokeContact: '@anna',
      phone: '+79991234567',
      telegram: '@anna_nails',
      whatsapp: ''
    }
  });
}

async function main() {
  const repo = new MemoryRepo();
  await seed(repo);
  const handler = createHandler({
    repo,
    telegram: {
      async sendMessage(chatId, text, options) {
        return { ok: true, result: { message_id: 1, chatId, text, options } };
      },
      async answerCallbackQuery() { return { ok: true }; },
      async editMessageReplyMarkup() { return { ok: true }; },
      async setWebhook() { return { ok: true }; }
    },
    secrets: SECRETS,
    publicUrl: 'http://127.0.0.1:' + PORT,
    secureCookie: false,
    now: () => new Date()
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__test/login-link') {
        const master = await repo.getMasterBySlug(url.searchParams.get('slug') || 'anna');
        if (!master) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        const token = await issueLoginToken({ repo, secrets: SECRETS, now: () => new Date() }, master);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, url: '/admin?token=' + encodeURIComponent(token) }));
        return;
      }
      const file = FILES[url.pathname];
      if (file && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        fs.createReadStream(path.join(ROOT, file[0])).pipe(res);
        return;
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
      const result = await handler({
        httpMethod: req.method,
        path: url.pathname,
        headers: req.headers,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        body,
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: req.socket.remoteAddress || '127.0.0.1' } }
      });
      res.writeHead(result.statusCode || 200, result.headers || {});
      res.end(result.body || '');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('internal');
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log('http://127.0.0.1:' + PORT + '/anna');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
