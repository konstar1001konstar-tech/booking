'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const crypto = require('crypto');
const { MemoryRepo } = require('../src/repo/memory');
const { S3Repo } = require('../src/repo/s3');
const { createHandler } = require('../src/handler');
const { createTelegram, pinnedFetch, parseIps } = require('../src/telegram');
const outbox = require('../src/outbox');

const T0 = new Date('2026-11-02T06:00:00.000Z').getTime();

function clock() {
  let t = T0;
  return { now: () => new Date(t), advance: (ms) => { t += ms; } };
}

// Telegram, который можно «уронить»: пока down=true — сетевая ошибка.
function flakyTelegram() {
  const tg = { down: true, sent: [], calls: 0, permanent: false };
  tg.sendMessage = async (chatId, text, options) => {
    tg.calls += 1;
    if (tg.permanent) {
      const err = new Error('telegram'); err.code = 'telegram'; err.status = 403; err.permanent = true; throw err;
    }
    if (tg.down) { const err = new Error('net'); err.code = 'network'; throw err; }
    tg.sent.push({ chatId: String(chatId), text, options: options || {} });
    return { ok: true, result: { message_id: 100 + tg.sent.length } };
  };
  tg.answerCallbackQuery = async () => ({ ok: true });
  tg.editMessageReplyMarkup = async () => ({ ok: true });
  tg.setWebhook = async () => ({ ok: true });
  return tg;
}

const profile = {
  name: 'Анна', desc: '', photo: '', addr: 'ул. 1', hint: '',
  services: [{ name: 'Маникюр', price: 1500, dur: '1,5 ч' }],
  slots: ['10:00', '12:30', '15:00', '18:00'], gallery: [], tz: 'Europe/Moscow',
  workDays: [1, 2, 3, 4, 5, 6], horizon: 14, category: 'manicure', theme: 'plum',
  legalName: 'Анна', legalStatus: 'self', inn: '', revokeContact: '@anna',
  phone: '+79991234567', telegram: '@anna', whatsapp: ''
};

async function setup(repo) {
  const r = repo || new MemoryRepo();
  const telegram = flakyTelegram();
  const c = clock();
  const deps = {
    repo: r, telegram, now: c.now,
    secrets: { botToken: '1:x', sessionSecret: 's', webhookSecret: 'w' },
    publicUrl: 'https://card.test', secureCookie: false, setWebhook: false
  };
  await r.insertMaster({
    slug: 'anna', chatId: '1001', telegramUserId: '1001', published: true,
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', profile
  });
  return { repo: r, telegram, clock: c, deps, handler: createHandler(deps) };
}

function bookingEvent(time) {
  return {
    httpMethod: 'POST', path: '/api/bookings', headers: { 'X-Forwarded-For': '1.2.3.4' },
    body: JSON.stringify({ slug: 'anna', serviceName: 'Маникюр', date: '2026-11-03', time: time || '10:00', name: 'Мария', phone: '+79991112233', consent: true })
  };
}

const timerEvent = {
  messages: [{ event_metadata: { event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage' }, details: { trigger_id: 't' } }]
};

test('outbox: заявка при недоступном Telegram сохраняется и досылается таймером', async () => {
  const { repo, telegram, clock: c, handler } = await setup();
  const res = await handler(bookingEvent());
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.notified, false);
  assert.equal(body.queued, true);
  assert.equal(telegram.calls, 1, 'одна быстрая попытка');
  assert.deepEqual(await repo.listOutbox(), ['b_' + body.bookingId]);

  // Таймер, пока сеть лежит: две попытки, запись остаётся с отсрочкой.
  let out = await handler(timerEvent);
  assert.equal(JSON.parse(out.body).outbox.retry, 1);
  assert.equal((await repo.listOutbox()).length, 1);
  // Сразу повторно — ещё рано (backoff).
  out = await handler(timerEvent);
  assert.equal(JSON.parse(out.body).outbox.later, 1);

  telegram.down = false;
  c.advance(2 * 60 * 1000);
  out = await handler(timerEvent);
  assert.equal(JSON.parse(out.body).outbox.sent, 1);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatId, '1001');
  assert.equal(telegram.sent[0].options.parseMode, 'HTML');
  assert.ok(telegram.sent[0].options.replyMarkup.inline_keyboard);
  assert.equal((await repo.getBooking(body.bookingId)).tgMessageId, '101');

  // Повторный прогон ничего не шлёт: дубля нет.
  await handler(timerEvent);
  assert.equal(telegram.sent.length, 1);
});

test('outbox: быстрый успех не создаёт запись, ответ notified:true', async () => {
  const { repo, telegram, handler } = await setup();
  telegram.down = false;
  const body = JSON.parse((await handler(bookingEvent('12:30'))).body);
  assert.equal(body.notified, true);
  assert.equal(body.queued, false);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.equal((await repo.getBooking(body.bookingId)).tgMessageId, '101');
});

test('outbox: сдаётся через 24 часа, пропускает подтверждённые и постоянные ошибки', async () => {
  const { repo, telegram, clock: c, handler, deps } = await setup();
  const a = JSON.parse((await handler(bookingEvent('10:00'))).body);
  const b = JSON.parse((await handler(bookingEvent('12:30'))).body);
  const d = JSON.parse((await handler(bookingEvent('15:00'))).body);
  assert.equal((await repo.listOutbox()).length, 3);
  await repo.setBookingStatus(b.bookingId, 'confirmed', new Date().toISOString());
  await repo.deleteBooking(d.bookingId);
  let stats = await outbox.processOutbox(deps);
  assert.equal(stats.dropped, 2);
  assert.deepEqual(await repo.listOutbox(), ['b_' + a.bookingId]);
  c.advance(25 * 3600 * 1000);
  stats = await outbox.processOutbox(deps);
  assert.equal(stats.expired, 1);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.equal(telegram.sent.length, 0);

  // Постоянная ошибка Telegram (бот заблокирован) не ставится в очередь.
  telegram.permanent = true;
  const e = JSON.parse((await handler(bookingEvent('18:00'))).body);
  assert.equal(e.notified, false);
  assert.equal(e.queued, false);
  assert.deepEqual(await repo.listOutbox(), []);
});

test('outbox: занятую другим прогоном запись не шлём второй раз', async () => {
  const { repo, telegram, deps, handler } = await setup();
  await handler(bookingEvent());
  telegram.down = false;
  const [id] = await repo.listOutbox();
  const row = await repo.getOutbox(id);
  // Другой прогон захватил запись.
  await repo.claimOutbox(id, Object.assign({}, row.value, { lockedUntil: T0 + 60000 }), row.etag);
  const stats = await outbox.processOutbox(deps);
  assert.equal(stats.later, 1);
  assert.equal(telegram.sent.length, 0);
  // Устаревший etag не даёт захватить.
  assert.equal(await repo.claimOutbox(id, row.value, row.etag), null);
});

test('outbox: ответы бота в вебхуке тоже досылаются', async () => {
  const { repo, telegram, handler } = await setup();
  const res = await handler({
    httpMethod: 'POST', path: '/api/telegram/webhook',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'w' },
    body: JSON.stringify({ message: { chat: { id: 1001 }, from: { id: 1001 }, text: '/start' } })
  });
  assert.equal(res.statusCode, 200);
  const ids = await repo.listOutbox();
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^m_/);
  telegram.down = false;
  await handler(timerEvent);
  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /card\.test\/anna/);
  assert.deepEqual(await repo.listOutbox(), []);
});

test('outbox: таймер не путается с HTTP-событием', () => {
  assert.equal(outbox.isTimerEvent(timerEvent), true);
  assert.equal(outbox.isTimerEvent({ httpMethod: 'GET', path: '/' }), false);
  assert.equal(outbox.isTimerEvent({ messages: [{ event_metadata: { event_type: 'yandex.cloud.events.messagequeue.QueueMessage' } }] }), false);
});

// Тот же fakeS3, что и в s3repo.test.js, в упрощённом виде.
function fakeS3() {
  const objects = new Map();
  return async function fetchMock(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || 'GET';
    const headers = (init && init.headers) || {};
    const key = u.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const reply = (status, body, extra) => new Response(body == null ? null : body, { status, headers: extra || {} });
    if (method === 'GET' && !key) {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      return reply(200, '<ListBucketResult><IsTruncated>false</IsTruncated>' + keys.map((k) => '<Contents><Key>' + k + '</Key></Contents>').join('') + '</ListBucketResult>');
    }
    const cur = objects.get(key);
    if (method === 'GET') return cur ? reply(200, cur.body, { ETag: cur.etag }) : reply(404, 'NoSuchKey');
    if (method === 'DELETE') { objects.delete(key); return reply(204); }
    if (headers['If-None-Match'] === '*' && cur) return reply(412);
    if (headers['If-Match'] && (!cur || cur.etag !== headers['If-Match'])) return reply(412);
    const etag = '"' + crypto.createHash('md5').update(init.body).digest('hex') + '"';
    objects.set(key, { body: init.body, etag });
    return reply(200, '', { ETag: etag });
  };
}

test('outbox: s3 repo хранит записи в data/outbox/ и досылает их', async () => {
  const repo = new S3Repo({ bucket: 'bucket', getToken: async () => 'iam', fetch: fakeS3() });
  const { telegram, handler } = await setup(repo);
  const body = JSON.parse((await handler(bookingEvent())).body);
  assert.equal(body.queued, true);
  assert.deepEqual(await repo.listOutbox(), ['b_' + body.bookingId]);
  const row = await repo.getOutbox('b_' + body.bookingId);
  assert.equal(row.value.chatId, '1001');
  assert.ok(row.etag);
  telegram.down = false;
  await handler(timerEvent);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.equal((await repo.getBooking(body.bookingId)).tgMessageId, '101');
});

test('telegram: RELAY_IPS разбирается, зависшее соединение обрывается по таймауту', async () => {
  assert.deepEqual(parseIps('76.76.21.21, 1.2.3.4 bad'), ['76.76.21.21', '1.2.3.4']);
  assert.deepEqual(parseIps(''), []);
  // Сервер принимает TCP и молчит — как зависшее TLS-рукопожатие до Vercel.
  const sockets = [];
  const server = net.createServer((s) => sockets.push(s));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const tg = createTelegram(() => '1:x', {
    relayUrl: 'https://relay.example:' + port + '/api/tg', relayKey: 'k',
    relayIps: '127.0.0.1', timeoutMs: 300
  });
  const t = Date.now();
  await assert.rejects(tg.sendMessage(1, 'hi'), (err) => err.code === 'network');
  assert.ok(Date.now() - t < 2000);
  assert.equal(sockets.length, 1, 'подключение шло на закреплённый IP');
  sockets.forEach((s) => s.destroy());
  server.close();
  assert.equal(typeof pinnedFetch(['127.0.0.1']), 'function');
});
