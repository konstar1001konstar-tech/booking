'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { S3Repo } = require('../src/repo/s3');
const { telegramRequest, createTelegram } = require('../src/telegram');

// Fake Object Storage: implements GET/PUT/DELETE/list-type=2 with
// If-None-Match: * and If-Match, like storage.yandexcloud.net.
function fakeS3() {
  const objects = new Map();
  const calls = [];
  async function fetchMock(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || 'GET';
    const headers = (init && init.headers) || {};
    calls.push({ method, url, headers });
    assert.equal(headers['X-YaCloud-SubjectToken'], 'iam-token');
    const parts = u.pathname.split('/').slice(1);
    assert.equal(parts[0], 'bucket');
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    const reply = (status, body, extra) => new Response(body == null ? null : body, { status, headers: extra || {} });
    if (method === 'GET' && !key) {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const xml = '<ListBucketResult><IsTruncated>false</IsTruncated>' +
        keys.map((k) => '<Contents><Key>' + k.replace(/&/g, '&amp;') + '</Key></Contents>').join('') + '</ListBucketResult>';
      return reply(200, xml);
    }
    const cur = objects.get(key);
    if (method === 'GET') return cur ? reply(200, cur.body, { ETag: cur.etag }) : reply(404, 'NoSuchKey');
    if (method === 'DELETE') { objects.delete(key); return reply(204); }
    if (method === 'PUT') {
      if (headers['If-None-Match'] === '*' && cur) return reply(412, 'PreconditionFailed');
      if (headers['If-Match'] && (!cur || cur.etag !== headers['If-Match'])) return reply(412, 'PreconditionFailed');
      const etag = '"' + crypto.createHash('md5').update(init.body).digest('hex') + '"';
      objects.set(key, { body: init.body, etag });
      return reply(200, '', { ETag: etag });
    }
    return reply(405);
  }
  return { objects, calls, fetch: fetchMock };
}

function makeRepo() {
  const s3 = fakeS3();
  const repo = new S3Repo({ bucket: 'bucket', getToken: async () => 'iam-token', fetch: s3.fetch });
  return { s3, repo };
}

const master = (slug, chatId) => ({
  slug, chatId: String(chatId), telegramUserId: String(chatId), published: false,
  profile: { name: 'Test' }, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z'
});

const booking = (id, slotKey, createdAt) => ({
  id, slug: 'demo', slotKey, date: slotKey.slice(0, 10), time: slotKey.slice(11),
  service: 'Маникюр', name: 'Клиент', phone: '+79990000000', comment: '',
  status: 'new', createdAt: createdAt || '2026-11-01T10:00:00.000Z', updatedAt: createdAt || '2026-11-01T10:00:00.000Z', tgMessageId: ''
});

test('s3 repo: masters are unique by slug and by chat', async () => {
  const { repo, s3 } = makeRepo();
  await repo.insertMaster(master('demo', 1));
  assert.equal((await repo.getMasterBySlug('demo')).chatId, '1');
  assert.equal((await repo.getMasterByChat(1)).slug, 'demo');
  await assert.rejects(repo.insertMaster(master('demo', 2)), { code: 'slug_taken' });
  await assert.rejects(repo.insertMaster(master('other', 1)), { code: 'chat_taken' });
  assert.equal(await repo.getMasterBySlug('other'), null);
  assert.equal(await repo.getMasterByChat(2), null);
  const updated = await repo.updateMasterProfile('demo', { name: 'New' }, true, '2026-11-01T11:00:00.000Z');
  assert.equal(updated.published, true);
  assert.equal((await repo.getMasterBySlug('demo')).profile.name, 'New');
  await assert.rejects(repo.updateMasterProfile('nope', {}, false, 'x'), { code: 'not_found' });
  assert.ok([...s3.objects.keys()].every((k) => k.startsWith('data/')));
});

test('s3 repo: a slot can be booked once, concurrently too', async () => {
  const { repo } = makeRepo();
  const results = await Promise.allSettled([
    repo.createBooking(booking('a1', '2026-11-03T10:00')),
    repo.createBooking(booking('a2', '2026-11-03T10:00'))
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.code === 'slot_taken').length, 1);
  await repo.createBooking(booking('b1', '2026-11-04T12:30', '2026-11-01T12:00:00.000Z'));
  assert.deepEqual((await repo.listBusy('demo', '2026-11-03', '2026-11-03')).sort(), ['2026-11-03T10:00']);
  assert.deepEqual((await repo.listBusy('demo', '2026-11-01', '2026-11-30')).sort(), ['2026-11-03T10:00', '2026-11-04T12:30']);
  assert.deepEqual(await repo.listBusy('other', '2026-11-01', '2026-11-30'), []);
  const list = await repo.listBookings('demo');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'b1');
});

test('s3 repo: status, message id, cancel frees the slot, delete', async () => {
  const { repo } = makeRepo();
  await repo.createBooking(booking('c1', '2026-11-05T15:00'));
  await repo.setMessageId('c1', 42);
  assert.equal((await repo.getBooking('c1')).tgMessageId, '42');
  assert.equal((await repo.setBookingStatus('c1', 'confirmed', 't1')).status, 'confirmed');
  await repo.setBookingStatus('c1', 'cancelled', 't2');
  await assert.rejects(repo.setBookingStatus('c1', 'confirmed', 't3'), { code: 'closed' });
  assert.deepEqual(await repo.listBusy('demo', '2026-11-05', '2026-11-05'), []);
  await repo.createBooking(booking('c2', '2026-11-05T15:00'));
  await repo.deleteBooking('c2');
  assert.equal(await repo.getBooking('c2'), null);
  assert.deepEqual(await repo.listBusy('demo', '2026-11-05', '2026-11-05'), []);
  await assert.rejects(repo.deleteBooking('c2'), { code: 'not_found' });
  await assert.rejects(repo.setBookingStatus('zz', 'confirmed', 't'), { code: 'not_found' });
  assert.equal(await repo.setMessageId('zz', 1), null);
});

test('s3 repo: rate counters, one-time logins, bot state', async () => {
  const { repo } = makeRepo();
  const counts = await Promise.all([1, 2, 3].map(() => repo.addRate('ip:1', 1000)));
  assert.deepEqual(counts.sort(), [1, 2, 3]);
  assert.equal(await repo.addRate('ip:1', 2000), 1);
  await repo.putLogin('j1', { slug: 'demo', chatId: '1', exp: 5000 });
  assert.equal((await repo.consumeLogin('j1', 1000)).slug, 'demo');
  assert.equal(await repo.consumeLogin('j1', 1000), null);
  await repo.putLogin('j2', { slug: 'demo', chatId: '1', exp: 5000 });
  assert.equal(await repo.consumeLogin('j2', 9000), null);
  assert.equal(await repo.getBotState(7), '');
  await repo.setBotState(7, 'await_slug');
  assert.equal(await repo.getBotState(7), 'await_slug');
  await repo.setBotState(7, '');
  assert.equal(await repo.getBotState(7), '');
});

test('telegram: relay mode sends token and key as headers', async () => {
  const direct = telegramRequest('123:abc', 'getMe', {}, null);
  assert.equal(direct.url, 'https://api.telegram.org/bot123:abc/getMe');
  const relayed = telegramRequest('123:abc', 'sendMessage', { a: 1 }, { relayUrl: 'https://relay.example/api/tg/', relayKey: 'k' });
  assert.equal(relayed.url, 'https://relay.example/api/tg/sendMessage');
  assert.equal(relayed.init.headers['X-Bot-Token'], '123:abc');
  assert.equal(relayed.init.headers['X-Relay-Key'], 'k');
  assert.ok(!relayed.url.includes('123:abc'));
  const seen = [];
  const tg = createTelegram(() => '123:abc', {
    relayUrl: 'https://relay.example/api/tg', relayKey: 'k',
    fetch: async (url, init) => { seen.push({ url, init }); return new Response('{"ok":true,"result":{"message_id":5}}'); }
  });
  const out = await tg.sendMessage(1, 'hi');
  assert.equal(out.result.message_id, 5);
  assert.equal(seen[0].url, 'https://relay.example/api/tg/sendMessage');
});
