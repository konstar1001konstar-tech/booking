'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { MemoryRepo } = require('../src/repo/memory');
const { createHandler } = require('../src/handler');
const { escapeHtml, bookingMessage } = require('../src/lib/html');
const { checkTelegramLogin } = require('../src/lib/telegram-auth');
const { sanitizeProfile } = require('../src/lib/profile');
const { readCookie } = require('../src/lib/session');

const NOW = new Date('2026-11-02T06:00:00.000Z');

function profile(extra) {
  return Object.assign({
    name: 'Анна | Маникюр',
    desc: 'Аккуратно',
    photo: '',
    addr: 'ул. Малая Бронная, 12',
    hint: '',
    services: [{ name: 'Маникюр', price: 1500, dur: '1,5 ч' }],
    slots: ['10:00', '12:30', '15:00', '18:00'],
    gallery: [],
    tz: 'Europe/Moscow',
    workDays: [1, 2, 3, 4, 5, 6],
    horizon: 14,
    category: 'manicure',
    theme: 'plum',
    legalName: 'Анна Иванова',
    legalStatus: 'self',
    inn: '',
    revokeContact: '@anna',
    city: 'Москва',
    pubConsentAt: '2026-11-01T00:00:00.000Z',
    termsAt: '2026-11-01T00:00:00.000Z',
    pubConsent: true,
    terms: true,
    phone: '+79991234567',
    telegram: '@anna_nails',
    whatsapp: ''
  }, extra || {});
}

function fakeTelegram() {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, options) {
      sent.push({ chatId: String(chatId), text, options: options || {} });
      return { ok: true, result: { message_id: sent.length } };
    },
    async answerCallbackQuery(id, text) {
      sent.push({ method: 'answer', id, text });
      return { ok: true };
    },
    async editMessageReplyMarkup(chatId, messageId) {
      sent.push({ method: 'edit', chatId: String(chatId), messageId });
      return { ok: true };
    },
    async setWebhook() {
      return { ok: true };
    }
  };
}

function make(extra) {
  const repo = new MemoryRepo();
  const telegram = fakeTelegram();
  const opts = extra || {};
  const handler = createHandler({
    repo,
    telegram,
    secrets: {
      botToken: '123456:TESTTOKEN',
      sessionSecret: 'session-secret',
      webhookSecret: 'webhook-secret'
    },
    now: opts.now || (() => NOW),
    publicUrl: 'https://card.test',
    secureCookie: false,
    limits: opts.limits,
    setWebhook: false
  });
  return { repo, telegram, handler };
}

async function call(handler, event) {
  const res = await handler(event);
  let body = {};
  try { body = JSON.parse(res.body); } catch (e) { body = { raw: res.body }; }
  return { status: res.statusCode, body, headers: res.headers || {}, raw: res.body };
}

function bookingBody(extra) {
  return Object.assign({
    slug: 'anna-nails',
    serviceName: 'Маникюр',
    date: '2026-11-02',
    time: '10:00',
    name: 'Мария',
    phone: '+7 (999) 123-45-67',
    consent: true,
    chatId: '999999'
  }, extra || {});
}

async function seed(repo, extra) {
  const row = Object.assign({
    slug: 'anna-nails',
    chatId: '1001',
    telegramUserId: '1001',
    published: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    profile: profile()
  }, extra || {});
  if (extra && extra.profile) row.profile = profile(extra.profile);
  await repo.insertMaster(row);
  return row;
}

test('экранирование HTML для Telegram не пропускает теги клиента', () => {
  assert.equal(escapeHtml('a<b>&"'), 'a&lt;b&gt;&amp;&quot;');
  const text = bookingMessage({
    serviceName: '<i>гель</i>',
    servicePrice: 1500,
    dateText: '2 ноября',
    time: '10:00',
    clientName: '<script>',
    clientPhone: '+79990000000'
  }, { profile: { category: 'manicure', addr: 'дом <1>' } }, 'https://card.test/admin');
  assert.equal(text.includes('<script>'), false);
  assert.equal(text.includes('<i>'), false);
  assert.equal(text.includes('&lt;i&gt;гель&lt;/i&gt;'), true);
  // 152-ФЗ: имя и телефон клиента в Telegram (и через релей вне РФ) не уходят.
  assert.equal(text.includes('script'), false);
  assert.equal(text.includes('79990000000'), false);
  assert.equal(text.includes('https://card.test/admin'), true);
  assert.equal(text.includes('дом &lt;1&gt;'), true);
  assert.equal(text.includes('<b>Новая заявка</b>'), true);
});

test('проверка hash Telegram Login Widget', () => {
  const token = '123456:TESTTOKEN';
  const fields = {
    id: '42',
    first_name: 'Анна',
    username: 'anna',
    auth_date: '1700000000'
  };
  const check = ['auth_date=1700000000', 'first_name=Анна', 'id=42', 'username=anna'].join('\n');
  const secret = crypto.createHash('sha256').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const now = 1700000000 * 1000;
  const user = checkTelegramLogin(Object.assign({ hash }, fields), token, now);
  assert.equal(user.id, '42');
  assert.equal(user.firstName, 'Анна');
  assert.equal(checkTelegramLogin(Object.assign({ hash: 'deadbeef' }, fields), token, now), null);
  const stale = Object.assign({ hash }, fields, { auth_date: '1600000000' });
  const staleCheck = ['auth_date=1600000000', 'first_name=Анна', 'id=42', 'username=anna'].join('\n');
  const staleHash = crypto.createHmac('sha256', secret).update(staleCheck).digest('hex');
  assert.equal(checkTelegramLogin(Object.assign({}, stale, { hash: staleHash }), token, now), null);
  assert.equal(checkTelegramLogin(Object.assign({ hash }, fields), 'other-token', now), null);
});

test('профиль мастера: пустые услуги, чужой адрес фото и повтор названия', () => {
  assert.equal(sanitizeProfile({ name: 'Анна', services: [], slots: '10:00', workDays: [1], horizon: 14 }).ok, false);
  const badPhoto = sanitizeProfile({
    name: 'Анна',
    services: [{ name: 'Маникюр', price: 1000, dur: '1 ч' }],
    slots: '10:00',
    workDays: [1],
    horizon: 14,
    photo: 'http://insecure.example/a.jpg'
  });
  assert.equal(badPhoto.ok, false);
  const dup = sanitizeProfile({
    name: 'Анна',
    services: [
      { name: 'Маникюр', price: 1000, dur: '1 ч' },
      { name: 'маникюр', price: 1200, dur: '1 ч' }
    ],
    slots: '10:00',
    workDays: [1],
    horizon: 14
  });
  assert.equal(dup.ok, false);
  const ok = sanitizeProfile({
    name: 'Анна',
    services: [{ name: 'Маникюр', price: '1 500', dur: '1,5 ч' }],
    slots: '18:00, 10:00',
    workDays: [1, 1, 6],
    horizon: 14,
    tz: 'Europe/Moscow'
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.profile.slots, ['10:00', '18:00']);
  assert.equal(ok.profile.services[0].price, 1500);
});

test('заявка проверяет поля и не берёт chat_id из браузера', async () => {
  const { repo, telegram, handler } = make();
  await seed(repo);
  const missing = await call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    body: JSON.stringify(bookingBody({ consent: false }))
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'validation');
  const badPhone = await call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    body: JSON.stringify(bookingBody({ phone: '123' }))
  });
  assert.equal(badPhone.status, 400);
  const ok = await call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '203.0.113.10' } },
    body: JSON.stringify(bookingBody({ name: '<script>' }))
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.notified, true);
  assert.equal(telegram.sent[0].chatId, '1001');
  assert.equal(telegram.sent[0].options.parseMode, 'HTML');
  assert.equal(telegram.sent[0].text.includes('script'), false);
  assert.equal(telegram.sent[0].text.includes('9991234567'), false);
  assert.equal(telegram.sent[0].text.includes('Маникюр'), true);
  const kb = telegram.sent[0].options.replyMarkup.inline_keyboard;
  assert.equal(kb[1][0].url, 'https://card.test/admin');
  const stored = await repo.getBooking(ok.body.bookingId);
  assert.equal(stored.clientPhone, '+79991234567');
  assert.equal(stored.servicePrice, 1500);
});

test('публичная страница не отдаёт chat_id', async () => {
  const { repo, handler } = make();
  await seed(repo);
  const res = await call(handler, { httpMethod: 'GET', path: '/api/masters/anna-nails' });
  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(res.body).includes('1001'), false);
  assert.equal(res.body.profile.chatId, undefined);
  await repo.updateMasterProfile('anna-nails', profile(), false, NOW.toISOString());
  const hidden = await call(handler, { httpMethod: 'GET', path: '/api/masters/anna-nails' });
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error, 'not_published');
});

test('слот нельзя занять дважды, отмена освобождает его', async () => {
  const { repo, handler } = make();
  await seed(repo);
  const event = (time) => ({
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '203.0.113.20' } },
    body: JSON.stringify(bookingBody({ time, phone: '+79990000001' }))
  });
  const [first, second] = await Promise.all([call(handler, event('12:30')), call(handler, event('12:30'))]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = first.status === 200 ? first : second;
  const busy = await call(handler, {
    httpMethod: 'GET',
    path: '/api/masters/anna-nails/slots',
    queryStringParameters: { from: '2026-11-02', to: '2026-11-02' }
  });
  assert.equal(busy.body.busy.includes('2026-11-02T12:30'), true);
  assert.equal(busy.body.tz, 'Europe/Moscow');
  const token = await login(handler, repo);
  const cancelled = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/bookings/' + winner.body.bookingId + '/cancel',
    headers: { Cookie: 'bc_session=' + token }
  });
  assert.equal(cancelled.status, 200);
  const again = await call(handler, event('12:30'));
  assert.equal(again.status, 200);
});

test('прошедшее время и выходной не записываются', async () => {
  const late = make({ now: () => new Date('2026-11-02T12:00:00.000Z') });
  await seed(late.repo);
  const past = await call(late.handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    body: JSON.stringify(bookingBody({ time: '10:00' }))
  });
  assert.equal(past.status, 400);
  assert.match(past.body.message, /прошло/);
  const sunday = await call(late.handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    body: JSON.stringify(bookingBody({ date: '2026-11-08', time: '18:00' }))
  });
  assert.equal(sunday.status, 400);
  assert.match(sunday.body.message, /не принимает/);
});

test('лимит по телефону и IP', async () => {
  const { repo, handler } = make({
    limits: {
      ip: { windowMs: 600000, limit: 10 },
      phone: { windowMs: 3600000, limit: 1 }
    }
  });
  await seed(repo);
  const send = (time, phone, ip) => call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: ip } },
    body: JSON.stringify(bookingBody({ time, phone }))
  });
  const first = await send('10:00', '+79990000002', '203.0.113.30');
  assert.equal(first.status, 200);
  const second = await send('12:30', '+7 999 000-00-02', '203.0.113.31');
  assert.equal(second.status, 429);
  assert.equal(second.body.error, 'rate_limited');
  const other = await send('15:00', '+79990000003', '203.0.113.31');
  assert.equal(other.status, 200);

  const tight = make({
    limits: {
      ip: { windowMs: 600000, limit: 1 },
      phone: { windowMs: 3600000, limit: 10 }
    }
  });
  await seed(tight.repo);
  const a = await call(tight.handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '198.51.100.8' } },
    body: JSON.stringify(bookingBody({ time: '10:00', phone: '+79991111111' }))
  });
  const b = await call(tight.handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '198.51.100.8' } },
    body: JSON.stringify(bookingBody({ time: '12:30', phone: '+79992222222' }))
  });
  assert.equal(a.status, 200);
  assert.equal(b.status, 429);
});

async function login(handler, repo) {
  const master = await repo.getMasterBySlug('anna-nails');
  const { issueLoginToken } = require('../src/service');
  const token = await issueLoginToken({
    repo,
    secrets: { sessionSecret: 'session-secret' },
    now: () => NOW
  }, master);
  const opened = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/session',
    body: JSON.stringify({ token })
  });
  assert.equal(opened.status, 200);
  const session = readCookie(opened.headers['Set-Cookie'], 'bc_session');
  assert.ok(session);
  const again = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/session',
    body: JSON.stringify({ token })
  });
  assert.equal(again.status, 401);
  return session;
}

test('вход по одноразовой ссылке и чужая заявка недоступна', async () => {
  const { repo, handler } = make();
  await seed(repo);
  const session = await login(handler, repo);
  const saved = await call(handler, {
    httpMethod: 'PUT',
    path: '/api/admin/profile',
    headers: { Cookie: 'bc_session=' + session },
    body: JSON.stringify(Object.assign(profile(), {
      desc: 'Новое описание',
      chatId: '1',
      services: [{ name: 'Маникюр', price: 1800, dur: '1,5 ч' }]
    }))
  });
  assert.equal(saved.status, 200);
  const master = await repo.getMasterBySlug('anna-nails');
  assert.equal(master.chatId, '1001');
  assert.equal(master.profile.desc, 'Новое описание');
  assert.equal(master.published, true);

  await repo.insertMaster({
    slug: 'other-master',
    chatId: '2002',
    telegramUserId: '2002',
    published: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    profile: profile({ name: 'Ольга' })
  });
  const booked = await call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '203.0.113.50' } },
    body: JSON.stringify(bookingBody())
  });
  assert.equal(booked.status, 200);
  const { issueLoginToken } = require('../src/service');
  const otherToken = await issueLoginToken({
    repo,
    secrets: { sessionSecret: 'session-secret' },
    now: () => NOW
  }, await repo.getMasterBySlug('other-master'));
  const otherSession = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/session',
    body: JSON.stringify({ token: otherToken })
  });
  const otherCookie = readCookie(otherSession.headers['Set-Cookie'], 'bc_session');
  const stolen = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/bookings/' + booked.body.bookingId + '/cancel',
    headers: { Cookie: 'bc_session=' + otherCookie }
  });
  assert.equal(stolen.status, 404);
  const own = await call(handler, {
    httpMethod: 'GET',
    path: '/api/admin/bookings',
    headers: { Cookie: 'bc_session=' + session }
  });
  assert.equal(own.body.bookings.length, 1);
  assert.equal(own.body.bookings[0].name, 'Мария');
});

test('вебхук проверяет secret_token, регистрирует мастера и подтверждает запись', async () => {
  const { repo, telegram, handler } = make();
  const denied = await call(handler, {
    httpMethod: 'POST',
    path: '/api/telegram/webhook',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
    body: JSON.stringify({ message: { chat: { id: 42 }, from: { id: 42 }, text: '/start' } })
  });
  assert.equal(denied.status, 401);

  const hook = (body) => call(handler, {
    httpMethod: 'POST',
    path: '/api/telegram/webhook',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' },
    body: JSON.stringify(body)
  });
  const started = await hook({ message: { chat: { id: 42 }, from: { id: 42, first_name: 'Анна' }, text: '/start' } });
  assert.equal(started.status, 200);
  assert.match(telegram.sent.at(-1).text, /anna-nails/);
  const created = await hook({ message: { chat: { id: 42 }, from: { id: 42, first_name: 'Анна' }, text: 'Anna-Nails' } });
  assert.equal(created.status, 200);
  const master = await repo.getMasterBySlug('anna-nails');
  assert.equal(master.chatId, '42');
  assert.equal(master.published, false);
  const link = telegram.sent.at(-1).text;
  const token = new URL(link.split('\n').find((line) => line.startsWith('https://card.test/admin'))).searchParams.get('token');
  const opened = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/session',
    body: JSON.stringify({ token })
  });
  assert.equal(opened.body.slug, 'anna-nails');

  await repo.updateMasterProfile('anna-nails', profile(), true, NOW.toISOString());
  const booked = await call(handler, {
    httpMethod: 'POST',
    path: '/api/bookings',
    requestContext: { identity: { sourceIp: '203.0.113.77' } },
    body: JSON.stringify(bookingBody({ phone: '+79995554433' }))
  });
  const foreign = await hook({
    callback_query: {
      id: 'cb1',
      data: 'ok:' + booked.body.bookingId,
      message: { message_id: 5, chat: { id: 999 } }
    }
  });
  assert.equal(foreign.status, 200);
  assert.equal((await repo.getBooking(booked.body.bookingId)).status, 'pending');
  const confirmed = await hook({
    callback_query: {
      id: 'cb2',
      data: 'ok:' + booked.body.bookingId,
      message: { message_id: 7, chat: { id: 42 } }
    }
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await repo.getBooking(booked.body.bookingId)).status, 'confirmed');
  assert.equal(telegram.sent.some((row) => row.method === 'answer' && row.text === 'Запись подтверждена'), true);
});

test('виджет Telegram открывает сессию только известному мастеру', async () => {
  const { repo, handler } = make();
  await seed(repo, { chatId: '42', telegramUserId: '42' });
  const token = '123456:TESTTOKEN';
  const fields = { id: '42', first_name: 'Анна', auth_date: String(Math.floor(NOW.getTime() / 1000)) };
  const check = 'auth_date=' + fields.auth_date + '\nfirst_name=Анна\nid=42';
  const secret = crypto.createHash('sha256').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const ok = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/telegram-widget',
    body: JSON.stringify(Object.assign({ hash }, fields))
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.slug, 'anna-nails');
  const stranger = { id: '77', first_name: 'Нет', auth_date: fields.auth_date };
  const strangerCheck = 'auth_date=' + stranger.auth_date + '\nfirst_name=Нет\nid=77';
  const strangerHash = crypto.createHmac('sha256', secret).update(strangerCheck).digest('hex');
  const unknown = await call(handler, {
    httpMethod: 'POST',
    path: '/api/admin/telegram-widget',
    body: JSON.stringify(Object.assign({ hash: strangerHash }, stranger))
  });
  assert.equal(unknown.status, 404);
});

test('HTML страницы подставляет OG по короткой ссылке', async () => {
  const { repo, handler } = make();
  await seed(repo, { profile: { name: 'Анна & Ко', photo: 'https://cdn.example/a.jpg', desc: 'Тихо <и> спокойно' } });
  const res = await handler({ httpMethod: 'GET', path: '/anna-nails', headers: { Host: 'card.test' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>Анна &amp; Ко — онлайн-запись · БьютиЛинк<\/title>/);
  assert.match(res.body, /property="og:description" content="Тихо &lt;и&gt; спокойно"/);
  assert.match(res.body, /property="og:image" content="https:\/\/cdn.example\/a.jpg"/);
  assert.match(res.body, /property="og:url" content="https:\/\/card.test\/anna-nails"/);
  const missing = await handler({ httpMethod: 'GET', path: '/no-such-master' });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body, /Страница не найдена/);
});
