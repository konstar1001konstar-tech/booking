'use strict';

// 152-ФЗ / 149-ФЗ: вход через Яндекс ID и Mail.ru (VK ID), Telegram только для
// уведомлений, данные оператора, сроки хранения, хэши в счётчиках, /privacy.

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryRepo } = require('../src/repo/memory');
const { createHandler } = require('../src/handler');
const { readCookie } = require('../src/lib/session');
const { operatorMissing } = require('../src/lib/profile');

const NOW = new Date('2026-11-02T06:00:00.000Z');
const BASE = 'https://card.test';

function profile(extra) {
  return Object.assign({
    name: 'Анна', desc: '', photo: '', addr: 'ул. 1', hint: '',
    services: [{ name: 'Маникюр', price: 1500, dur: '1,5 ч' }],
    slots: ['10:00', '12:30', '15:00'], gallery: [], tz: 'Europe/Moscow',
    workDays: [1, 2, 3, 4, 5, 6], horizon: 14, category: 'manicure', theme: 'plum',
    legalName: 'Анна Иванова', legalStatus: 'self', inn: '', revokeContact: '@anna', city: 'Москва',
    pubConsentAt: '2026-11-01T00:00:00.000Z', termsAt: '2026-11-01T00:00:00.000Z',
    phone: '', telegram: '', whatsapp: '', vk: '', max: ''
  }, extra || {});
}

function fakeFetch(log) {
  return async (url, init) => {
    log.push({ url, init });
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url === 'https://oauth.yandex.ru/token') {
      const form = new URLSearchParams(init.body);
      if (form.get('code') !== 'good' || !form.get('code_verifier') || form.get('client_secret') !== 'ya-secret') return reply(400, { error: 'invalid_grant' });
      return reply(200, { access_token: 'ya-at' });
    }
    if (url.startsWith('https://login.yandex.ru/info')) {
      if (init.headers.Authorization !== 'OAuth ya-at') return reply(401, {});
      return reply(200, { id: '555', first_name: 'Ольга' });
    }
    if (url === 'https://id.vk.ru/oauth2/auth') {
      const form = new URLSearchParams(init.body);
      if (form.get('code') !== 'good' || form.get('device_id') !== 'dev1' || !form.get('code_verifier')) return reply(400, { error: 'invalid_grant' });
      return reply(200, { access_token: 'vk-at', user_id: 777 });
    }
    if (url === 'https://id.vk.ru/oauth2/user_info') return reply(200, { user: { user_id: '777', first_name: 'Ира' } });
    return reply(404, {});
  };
}

function make(opts) {
  const o = opts || {};
  const repo = new MemoryRepo();
  const sent = [];
  const fetchLog = [];
  let now = (o.now || NOW).getTime();
  const deps = {
    repo,
    telegram: {
      async sendMessage(chatId, text, options) { sent.push({ chatId: String(chatId), text, options: options || {} }); return { ok: true, result: { message_id: sent.length } }; },
      async answerCallbackQuery() { return { ok: true }; },
      async editMessageReplyMarkup() { return { ok: true }; },
      async setWebhook() { return { ok: true }; }
    },
    secrets: { botToken: '1:x', sessionSecret: 'session-secret', webhookSecret: 'webhook-secret' },
    now: () => new Date(now),
    publicUrl: BASE,
    secureCookie: true,
    setWebhook: false,
    fetch: fakeFetch(fetchLog),
    allowTelegramLogin: o.allowTelegramLogin !== false,
    oauth: o.oauth === undefined
      ? { yandex: { clientId: 'ya-id', clientSecret: 'ya-secret' }, vkid: { clientId: 'vk-id' } }
      : o.oauth,
    owner: o.owner || { fio: 'Петров Пётр Петрович', inn: '771234567890', email: 'owner@example.ru' },
    botUsername: 'Test_bot',
    retentionMonths: 12
  };
  const handler = createHandler(deps);
  const call = async (event) => {
    const res = await handler(event);
    let body = {};
    try { body = JSON.parse(res.body); } catch (e) { body = { raw: res.body }; }
    const cookies = (res.multiValueHeaders && res.multiValueHeaders['Set-Cookie']) || [];
    return { status: res.statusCode, body, headers: res.headers || {}, cookies, raw: res.body };
  };
  return { repo, sent, fetchLog, deps, handler, call, advance: (ms) => { now += ms; } };
}

function cookieValue(cookies, name) {
  const line = cookies.find((c) => c.startsWith(name + '='));
  return line ? line.split(';')[0].slice(name.length + 1) : null;
}

async function oauthLogin(t, provider, extraQuery, cookieHeader) {
  const start = await t.call({ httpMethod: 'GET', path: '/api/auth/' + provider + '/start', queryStringParameters: extraQuery || {}, headers: cookieHeader ? { Cookie: cookieHeader } : {} });
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.Location);
  const flow = cookieValue(start.cookies, 'bc_oauth');
  assert.ok(flow);
  const state = loc.searchParams.get('state');
  const q = { code: 'good', state };
  if (provider === 'vkid') q.device_id = 'dev1';
  const cookie = 'bc_oauth=' + flow + (cookieHeader ? '; ' + cookieHeader : '');
  const cb = await t.call({ httpMethod: 'GET', path: '/api/auth/' + provider + '/callback', queryStringParameters: q, headers: { Cookie: cookie } });
  return { start, loc, cb, flow, state };
}

test('oauth: /api/config показывает только настроенных провайдеров', async () => {
  const t = make({ oauth: { yandex: { clientId: 'ya-id' }, vkid: { clientId: 'vk-id' } } });
  const conf = await t.call({ httpMethod: 'GET', path: '/api/config' });
  // У Яндекса нет client_secret — кнопки нет и /start закрыт.
  assert.deepEqual(conf.body.providers.map((p) => p.id), ['vkid']);
  assert.equal(conf.body.telegramLogin, true);
  assert.equal(conf.body.owner.inn, '771234567890');
  const ya = await t.call({ httpMethod: 'GET', path: '/api/auth/yandex/start' });
  assert.equal(ya.status, 404);
  const none = make({ oauth: {} });
  assert.deepEqual((await none.call({ httpMethod: 'GET', path: '/api/config' })).body.providers, []);
});

test('oauth: Яндекс ID — state, PKCE S256, регистрация мастера на сайте без бота', async () => {
  const t = make();
  const { loc, cb, start } = await oauthLogin(t, 'yandex');
  assert.equal(loc.origin + loc.pathname, 'https://oauth.yandex.ru/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), BASE + '/api/auth/yandex/callback');
  assert.ok(loc.searchParams.get('state').length >= 32);
  assert.match(start.cookies[0], /HttpOnly/);
  assert.match(start.cookies[0], /Secure/);
  assert.match(start.cookies[0], /SameSite=Lax/);
  const tokenCall = t.fetchLog.find((r) => r.url === 'https://oauth.yandex.ru/token');
  const verifier = new URLSearchParams(tokenCall.init.body).get('code_verifier');
  const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, loc.searchParams.get('code_challenge'));

  assert.equal(cb.status, 302);
  assert.equal(cb.headers.Location, '/admin?signup=1');
  const signup = cookieValue(cb.cookies, 'bc_signup');
  assert.ok(signup);
  const info = await t.call({ httpMethod: 'GET', path: '/api/auth/signup', headers: { Cookie: 'bc_signup=' + signup } });
  assert.equal(info.body.name, 'Ольга');

  const noTerms = await t.call({ httpMethod: 'POST', path: '/api/auth/signup', headers: { Cookie: 'bc_signup=' + signup }, body: JSON.stringify({ slug: 'olga-brows', name: 'Ольга' }) });
  assert.equal(noTerms.status, 400);
  const made = await t.call({ httpMethod: 'POST', path: '/api/auth/signup', headers: { Cookie: 'bc_signup=' + signup }, body: JSON.stringify({ slug: 'olga-brows', name: 'Ольга', terms: true }) });
  assert.equal(made.status, 200);
  const session = cookieValue(made.cookies, 'bc_session');
  assert.ok(session);
  const master = await t.repo.getMasterBySlug('olga-brows');
  assert.equal(master.chatId, '');
  assert.equal(master.identities.yandex.sub, '555');
  assert.equal(master.published, false);
  assert.ok(master.profile.termsAt);

  const me = await t.call({ httpMethod: 'GET', path: '/api/admin/me', headers: { Cookie: 'bc_session=' + session } });
  assert.equal(me.body.slug, 'olga-brows');
  assert.deepEqual(me.body.identities, ['yandex']);
  assert.equal(me.body.telegram, false);
  assert.ok(me.body.operatorMissing.length > 0);

  // Повторный вход тем же Яндекс ID — сразу сессия.
  const again = await oauthLogin(t, 'yandex');
  assert.equal(again.cb.headers.Location, '/olga-brows?admin=1');
  assert.ok(cookieValue(again.cb.cookies, 'bc_session'));
});

test('oauth: Mail.ru через VK ID (provider=mail_ru, device_id) и неверный state', async () => {
  const t = make();
  const { loc, cb } = await oauthLogin(t, 'vkid');
  assert.equal(loc.origin + loc.pathname, 'https://id.vk.ru/authorize');
  assert.equal(loc.searchParams.get('provider'), 'mail_ru');
  assert.equal(cb.headers.Location, '/admin?signup=1');
  const ex = t.fetchLog.find((r) => r.url === 'https://id.vk.ru/oauth2/auth');
  assert.equal(new URLSearchParams(ex.init.body).get('redirect_uri'), BASE + '/api/auth/vkid/callback');

  const start = await t.call({ httpMethod: 'GET', path: '/api/auth/vkid/start' });
  const flow = cookieValue(start.cookies, 'bc_oauth');
  const bad = await t.call({ httpMethod: 'GET', path: '/api/auth/vkid/callback', queryStringParameters: { code: 'good', state: 'x'.repeat(43), device_id: 'dev1' }, headers: { Cookie: 'bc_oauth=' + flow } });
  assert.equal(bad.headers.Location, '/admin?auth_error=state');
  const noCookie = await t.call({ httpMethod: 'GET', path: '/api/auth/vkid/callback', queryStringParameters: { code: 'good', state: new URL(start.headers.Location).searchParams.get('state'), device_id: 'dev1' } });
  assert.equal(noCookie.headers.Location, '/admin?auth_error=state');
  // Кука от другого провайдера не подходит.
  const cross = await t.call({ httpMethod: 'GET', path: '/api/auth/yandex/callback', queryStringParameters: { code: 'good', state: new URL(start.headers.Location).searchParams.get('state') }, headers: { Cookie: 'bc_oauth=' + flow } });
  assert.equal(cross.headers.Location, '/admin?auth_error=state');
});

async function telegramMasterSession(t) {
  await t.repo.insertMaster({ slug: 'anna-nails', chatId: '1001', telegramUserId: '1001', published: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), profile: profile() });
  const { issueLoginToken } = require('../src/service');
  const token = await issueLoginToken(t.deps, await t.repo.getMasterBySlug('anna-nails'));
  const opened = await t.call({ httpMethod: 'POST', path: '/api/admin/session', body: JSON.stringify({ token }) });
  assert.equal(opened.status, 200);
  return readCookie(opened.headers['Set-Cookie'], 'bc_session');
}

test('oauth: мастер из Telegram привязывает Яндекс ID и потом входит без Telegram', async () => {
  const t = make();
  const session = await telegramMasterSession(t);
  const noSession = await t.call({ httpMethod: 'GET', path: '/api/auth/yandex/start', queryStringParameters: { mode: 'link' } });
  assert.equal(noSession.headers.Location, '/admin?auth_error=session');
  const linked = await oauthLogin(t, 'yandex', { mode: 'link' }, 'bc_session=' + session);
  assert.equal(linked.cb.headers.Location, '/anna-nails?admin=1&linked=yandex');
  const master = await t.repo.getMasterBySlug('anna-nails');
  assert.equal(master.identities.yandex.sub, '555');
  assert.equal(master.chatId, '1001');
  // Старая сессия (из Telegram) продолжает работать.
  const me = await t.call({ httpMethod: 'GET', path: '/api/admin/me', headers: { Cookie: 'bc_session=' + session } });
  assert.deepEqual(me.body.identities, ['yandex']);
  // Вход через Яндекс — та же страница.
  const login = await oauthLogin(t, 'yandex');
  assert.equal(login.cb.headers.Location, '/anna-nails?admin=1');
  const s2 = cookieValue(login.cb.cookies, 'bc_session');
  const me2 = await t.call({ httpMethod: 'GET', path: '/api/admin/me', headers: { Cookie: 'bc_session=' + s2 } });
  assert.equal(me2.body.slug, 'anna-nails');
});

test('ALLOW_TELEGRAM_LOGIN=false: вход через бота и виджет закрыт, бот не шлёт ссылок входа', async () => {
  const on = make();
  const session = await telegramMasterSession(on);
  assert.ok(session);
  const t = make({ allowTelegramLogin: false });
  await t.repo.insertMaster({ slug: 'anna-nails', chatId: '1001', telegramUserId: '1001', published: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), profile: profile() });
  const { issueLoginToken } = require('../src/service');
  const token = await issueLoginToken(t.deps, await t.repo.getMasterBySlug('anna-nails'));
  const opened = await t.call({ httpMethod: 'POST', path: '/api/admin/session', body: JSON.stringify({ token }) });
  assert.equal(opened.status, 403);
  const widget = await t.call({ httpMethod: 'POST', path: '/api/admin/telegram-widget', body: JSON.stringify({ id: 1001, hash: 'x' }) });
  assert.equal(widget.status, 404);
  const conf = await t.call({ httpMethod: 'GET', path: '/api/config' });
  assert.equal(conf.body.telegramLogin, false);
  const hook = (chat, text) => t.call({ httpMethod: 'POST', path: '/api/telegram/webhook', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' }, body: JSON.stringify({ message: { chat: { id: chat }, from: { id: chat }, text } }) });
  await hook(1001, '/start');
  assert.equal(t.sent.at(-1).text.includes('token='), false);
  assert.match(t.sent.at(-1).text, /Яндекс ID или Mail\.ru/);
  assert.match(t.sent.at(-1).text, /\/privacy/);
  await hook(4242, '/start');
  assert.match(t.sent.at(-1).text, /Зарегистрируйтесь на сайте/);
  await hook(4242, 'new-master');
  assert.equal(await t.repo.getMasterBySlug('new-master'), null);
});

test('telegram: подключение уведомлений по deep link из панели', async () => {
  const t = make({ allowTelegramLogin: false });
  const { cb } = await oauthLogin(t, 'vkid');
  const signup = cookieValue(cb.cookies, 'bc_signup');
  const made = await t.call({ httpMethod: 'POST', path: '/api/auth/signup', headers: { Cookie: 'bc_signup=' + signup }, body: JSON.stringify({ slug: 'ira-nails', terms: true }) });
  const session = cookieValue(made.cookies, 'bc_session');
  const link = await t.call({ httpMethod: 'POST', path: '/api/admin/telegram-link', headers: { Cookie: 'bc_session=' + session } });
  assert.equal(link.status, 200);
  const code = /^https:\/\/t\.me\/Test_bot\?start=(link_[A-Za-z0-9_-]+)$/.exec(link.body.url)[1];
  const hook = (text) => t.call({ httpMethod: 'POST', path: '/api/telegram/webhook', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' }, body: JSON.stringify({ message: { chat: { id: 3003 }, from: { id: 3003 }, text } }) });
  await hook('/start ' + code);
  assert.match(t.sent.at(-1).text, /Готово/);
  const master = await t.repo.getMasterBySlug('ira-nails');
  assert.equal(master.chatId, '3003');
  assert.equal((await t.repo.getMasterByChat('3003')).slug, 'ira-nails');
  await hook('/start ' + code);
  assert.match(t.sent.at(-1).text, /устарела/);
  // Сессия после привязки Telegram жива (ownerId не меняется).
  const me = await t.call({ httpMethod: 'GET', path: '/api/admin/me', headers: { Cookie: 'bc_session=' + session } });
  assert.equal(me.body.telegram, true);
});

test('152-ФЗ: без данных оператора нельзя сохранить профиль и записаться', async () => {
  assert.deepEqual(operatorMissing(profile()), []);
  assert.ok(operatorMissing(profile({ city: '' })).includes('город'));
  assert.ok(operatorMissing(profile({ pubConsentAt: '' })).length === 1);
  const t = make();
  const session = await telegramMasterSession(t);
  const put = (p) => t.call({ httpMethod: 'PUT', path: '/api/admin/profile', headers: { Cookie: 'bc_session=' + session }, body: JSON.stringify(p) });
  const noCity = await put(Object.assign(profile({ city: '' }), { pubConsent: true, terms: true }));
  assert.equal(noCity.status, 400);
  assert.match(noCity.body.message, /город/);
  const noPub = await put(Object.assign(profile(), { pubConsent: false, terms: true }));
  assert.equal(noPub.status, 400);
  const ok = await put(Object.assign(profile({ vk: '@anna_vk', max: 'https://max.ru/u/anna' }), { pubConsent: true, terms: true }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.vk, 'https://vk.com/anna_vk');
  assert.equal(ok.body.profile.max, 'https://max.ru/u/anna');

  await t.repo.updateMasterProfile('anna-nails', profile({ legalName: '' }), true, NOW.toISOString());
  const booked = await t.call({ httpMethod: 'POST', path: '/api/bookings', body: JSON.stringify({ slug: 'anna-nails', serviceName: 'Маникюр', date: '2026-11-03', time: '10:00', name: 'Мария', phone: '+79991234567', consent: true }) });
  assert.equal(booked.status, 409);
  assert.equal(booked.body.error, 'operator_missing');
  const pub = await t.call({ httpMethod: 'GET', path: '/api/masters/anna-nails' });
  assert.equal(pub.body.bookingOpen, false);
});

test('счётчики защиты от спама хранят только HMAC телефона и IP', async () => {
  const t = make();
  await telegramMasterSession(t);
  const res = await t.call({ httpMethod: 'POST', path: '/api/bookings', requestContext: { identity: { sourceIp: '203.0.113.77' } }, body: JSON.stringify({ slug: 'anna-nails', serviceName: 'Маникюр', date: '2026-11-03', time: '10:00', name: 'Мария', phone: '+7 999 123-45-67', consent: true }) });
  assert.equal(res.status, 200);
  const keys = [...t.repo.rates.keys()].join('|');
  assert.equal(keys.includes('203.0.113.77'), false);
  assert.equal(keys.includes('9991234567'), false);
  assert.match(keys, /phone:[A-Za-z0-9_-]{22}:anna-nails/);
  assert.match(keys, /ip:[A-Za-z0-9_-]{22}:anna-nails/);
  // В Telegram — ни имени, ни телефона.
  assert.equal(t.sent[0].text.includes('Мария'), false);
  assert.equal(t.sent[0].text.includes('999'), false);
});

test('заявки удаляются через 12 месяцев после визита, раз в сутки', async () => {
  const t = make({ now: new Date('2027-11-10T06:00:00.000Z') });
  await t.repo.insertMaster({ slug: 'anna-nails', chatId: '1001', published: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), profile: profile() });
  const mk = (id, date) => t.repo.createBooking({ id, slug: 'anna-nails', chatId: '1001', serviceName: 'Маникюр', servicePrice: 1500, date, time: '10:00', slotKey: date + 'T10:00', dateText: date, clientName: 'М', clientPhone: '+79990000000', status: 'new', createdAt: NOW.toISOString() });
  await mk('old_booking_1', '2026-11-03');
  await mk('new_booking_1', '2026-11-12');
  const res = await t.handler({ messages: [{ event_metadata: { event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage' } }] });
  const body = JSON.parse(res.body);
  assert.equal(body.sweep.deleted, 1);
  assert.equal(body.sweep.cutoff, '2026-11-10');
  assert.equal(await t.repo.getBooking('old_booking_1'), null);
  assert.ok(await t.repo.getBooking('new_booking_1'));
  const again = JSON.parse((await t.handler({ messages: [{ event_metadata: { event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage' } }] })).body);
  assert.equal(again.sweep.skipped, true);
});

test('/privacy и /terms-masters: реквизиты владельца, сроки, права, РФ; пустые реквизиты не ломают страницу', async () => {
  const t = make();
  const priv = await t.call({ httpMethod: 'GET', path: '/privacy' });
  assert.equal(priv.status, 200);
  assert.match(priv.raw, /Петров Пётр Петрович/);
  assert.match(priv.raw, /ИНН 771234567890/);
  assert.match(priv.raw, /owner@example\.ru/);
  assert.match(priv.raw, /12 месяцев после даты визита/);
  assert.match(priv.raw, /10 рабочих дней/);
  assert.match(priv.raw, /ru-central1/);
  assert.match(priv.raw, /младше 14 лет/);
  assert.equal(/<script/i.test(priv.raw), false);
  const terms = await t.call({ httpMethod: 'GET', path: '/terms-masters' });
  assert.match(terms.raw, /ч\. 3 ст\. 6 152-ФЗ/);
  const empty = make({ owner: { fio: '', inn: '', email: '' } });
  const p2 = await empty.call({ httpMethod: 'GET', path: '/privacy' });
  assert.equal(p2.status, 200);
  assert.equal(/ИНН \d|ИНН ,|undefined|null/.test(p2.raw), false);
  assert.match(p2.raw, /@Test_bot/);
});
