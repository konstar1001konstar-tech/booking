'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const service = require('../src/service');
const { MemoryRepo } = require('../src/repo/memory');
const { createHandler } = require('../src/handler');
const tgHook = require('../../api/tg-hook');

test('webhook: WEBHOOK_URL важнее адреса сайта', async () => {
  assert.equal(service.webhookTarget({}, 'https://site.test'), 'https://site.test/api/telegram/webhook');
  assert.equal(service.webhookTarget({ webhookUrl: 'https://relay.test/api/tg-hook' }, 'https://site.test'), 'https://relay.test/api/tg-hook');

  const calls = [];
  const handler = createHandler({
    repo: new MemoryRepo(),
    telegram: { setWebhook: async (url, secret) => { calls.push({ url, secret }); return { ok: true }; } },
    secrets: { botToken: '1:x', sessionSecret: 's', webhookSecret: 'w' },
    publicUrl: 'https://site.test',
    setWebhook: true,
    webhookUrl: 'https://relay.test/api/tg-hook'
  });
  const res = await handler({ httpMethod: 'GET', path: '/api/health', headers: {} });
  assert.equal(JSON.parse(res.body).webhook, 'set');
  assert.deepEqual(calls, [{ url: 'https://relay.test/api/tg-hook', secret: 'w' }]);
});

function fakeReq(method, headers, body) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers || {};
  return req;
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b || ''; res.ended = true; };
  return res;
}

test('tg-hook: пересылает тело и секрет, возвращает статус Yandex', async (t) => {
  const seen = [];
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (url, init) => {
    seen.push({ url, init });
    const ok = init.headers['X-Telegram-Bot-Api-Secret-Token'] === 'good';
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 401 });
  };

  let res = fakeRes();
  await tgHook(fakeReq('POST', { 'x-telegram-bot-api-secret-token': 'good' }, '{"update_id":5}'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/api\/telegram\/webhook$/);
  assert.equal(seen[0].init.body, '{"update_id":5}');

  res = fakeRes();
  await tgHook(fakeReq('POST', { 'x-telegram-bot-api-secret-token': 'bad' }, '{}'), res);
  assert.equal(res.statusCode, 401, 'отказ Yandex передаётся Telegram');

  // Без секрета — даже не пересылаем.
  res = fakeRes();
  await tgHook(fakeReq('POST', {}, '{}'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(seen.length, 2);

  // Yandex не ответил — 502, Telegram повторит.
  global.fetch = async () => { throw new Error('timeout'); };
  res = fakeRes();
  await tgHook(fakeReq('POST', { 'x-telegram-bot-api-secret-token': 'good' }, '{}'), res);
  assert.equal(res.statusCode, 502);

  res = fakeRes();
  await tgHook(fakeReq('GET', {}), res);
  assert.equal(res.statusCode, 200);
});
