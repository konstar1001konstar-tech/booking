'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryRepo } = require('../src/repo/memory');
const { createHandler } = require('../src/handler');
const service = require('../src/service');
const photos = require('../src/photos');
const { sanitizeProfile, validateSlug } = require('../src/lib/profile');

const NOW = new Date('2026-11-02T06:00:00.000Z');
const BASE = 'https://card.test';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBPVP8 '), Buffer.alloc(200, 3)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200, 4)]);

function profile(extra) {
  return Object.assign({
    name: 'Анна', desc: '', photo: '', addr: '', hint: '',
    services: [{ name: 'Маникюр', price: 1500, dur: '' }],
    slots: ['10:00'], gallery: [], tz: 'Europe/Moscow', workDays: [1, 2, 3, 4, 5],
    horizon: 14, category: 'manicure', theme: 'plum', legalName: 'Анна Иванова', legalStatus: 'self',
    inn: '', revokeContact: '@anna', city: 'Москва', pubConsent: true, terms: true,
    phone: '', telegram: '', whatsapp: ''
  }, extra || {});
}

async function setup(opts) {
  const o = opts || {};
  let now = NOW.getTime();
  const repo = new MemoryRepo();
  const deps = {
    repo,
    telegram: { sendMessage: async () => ({ ok: true, result: { message_id: 1 } }) },
    secrets: { botToken: '1:x', sessionSecret: 'session-secret', webhookSecret: 'w' },
    now: () => new Date(now),
    publicUrl: BASE,
    secureCookie: false,
    setWebhook: false,
    limits: o.limits
  };
  const master = {
    slug: 'anna-nails', chatId: '1001', telegramUserId: '1001', published: true,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), profile: profile(o.profile)
  };
  await repo.insertMaster(master);
  const cookie = service.sessionCookie(deps, master).split(';')[0];
  const handler = createHandler(deps);
  const upload = async (buf, kind, extra) => {
    const res = await handler(Object.assign({
      httpMethod: 'POST',
      path: '/api/admin/photos',
      queryStringParameters: kind ? { kind } : {},
      headers: { Cookie: cookie, 'Content-Type': 'image/jpeg' },
      body: buf.toString('base64'),
      isBase64Encoded: true
    }, extra || {}));
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const save = async (p) => {
    const res = await handler({
      httpMethod: 'PUT', path: '/api/admin/profile',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(profile(p))
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return { repo, deps, handler, upload, save, cookie, advance: (ms) => { now += ms; } };
}

test('photos: загрузка JPEG/PNG/WebP даёт публичную ссылку под /media/<slug>/', async () => {
  const { repo, upload, cookie } = await setup();
  const a = await upload(JPEG, 'avatar');
  assert.equal(a.status, 200);
  assert.match(a.body.url, /^https:\/\/card\.test\/media\/anna-nails\/\d{13}-[A-Za-z0-9_-]+\.jpg$/);
  assert.equal(a.body.type, 'image/jpeg');
  const key = a.body.url.slice(BASE.length + 1);
  assert.equal(repo.media.get(key).type, 'image/jpeg');
  assert.ok(repo.media.get(key).buf.equals(JPEG));
  assert.match((await upload(PNG, 'gallery')).body.url, /\.png$/);
  assert.match((await upload(WEBP)).body.url, /\.webp$/);
  // JSON { data: base64 } тоже принимается.
  const viaJson = await upload(JPEG, 'gallery', {
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'data:image/jpeg;base64,' + JPEG.toString('base64') }),
    isBase64Encoded: false
  });
  assert.equal(viaJson.status, 200);
  assert.match(viaJson.body.url, /\.jpg$/);
});

test('photos: без сессии, не картинка, пусто, слишком большое, неизвестный kind', async () => {
  const { handler, upload } = await setup();
  const anon = await handler({ httpMethod: 'POST', path: '/api/admin/photos', headers: {}, body: JPEG.toString('base64'), isBase64Encoded: true });
  assert.equal(anon.statusCode, 401);
  assert.equal((await upload(GIF)).status, 415);
  assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(5)))).status, 415);
  assert.equal((await upload(Buffer.alloc(0))).status, 400);
  const big = Buffer.concat([JPEG.slice(0, 4), Buffer.alloc(photos.MAX_BYTES, 0)]);
  const tooBig = await upload(big);
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.message, /2 МБ/);
  assert.equal((await upload(JPEG, 'banner')).status, 400);
});

test('photos: лимит портфолио, лимит файлов и лимит частоты', async () => {
  const full = Array.from({ length: 12 }, (_, i) => 'https://x.test/' + i + '.jpg');
  const s1 = await setup({ profile: { gallery: full } });
  const r = await s1.upload(JPEG, 'gallery');
  assert.equal(r.status, 409);
  assert.equal((await s1.upload(JPEG, 'avatar')).status, 200, 'аватар при полном портфолио можно');

  const s2 = await setup();
  for (let i = 0; i < photos.MAX_FILES; i += 1) await s2.repo.putMedia('media/anna-nails/' + (NOW.getTime() + i) + '-abcdefgh.jpg', JPEG, 'image/jpeg');
  assert.equal((await s2.upload(JPEG, 'avatar')).status, 409);

  const s3 = await setup({ limits: { photo: { windowMs: 3600000, limit: 2 } } });
  assert.equal((await s3.upload(JPEG)).status, 200);
  assert.equal((await s3.upload(JPEG)).status, 200);
  assert.equal((await s3.upload(JPEG)).status, 429);
});

test('photos: сохранение профиля удаляет убранные и старые несохранённые фото', async () => {
  const { repo, upload, save, advance } = await setup();
  const a1 = (await upload(JPEG, 'avatar')).body.url;
  const g1 = (await upload(JPEG, 'gallery')).body.url;
  const g2 = (await upload(PNG, 'gallery')).body.url;
  let res = await save({ photo: a1, gallery: [g1, g2, 'https://other.example/p.jpg'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.profile.gallery, [g1, g2, 'https://other.example/p.jpg']);
  assert.equal(repo.media.size, 3);

  // Несохранённая загрузка свежая — остаётся; убранное из профиля — удаляется сразу.
  const fresh = (await upload(JPEG, 'gallery')).body.url;
  res = await save({ photo: a1, gallery: [g2] });
  assert.equal(res.status, 200);
  const keys = () => [...repo.media.keys()].map((k) => BASE + '/' + k).sort();
  assert.deepEqual(keys(), [a1, g2, fresh].sort());

  // Через 31 минуту несохранённая загрузка считается брошенной.
  advance(31 * 60 * 1000);
  await save({ photo: '', gallery: [g2] });
  assert.deepEqual(keys(), [g2]);
});

test('photos: распознавание форматов, свои ссылки, адрес media зарезервирован, портфолио до 12', () => {
  assert.equal(photos.sniff(JPEG).type, 'image/jpeg');
  assert.equal(photos.sniff(PNG).type, 'image/png');
  assert.equal(photos.sniff(WEBP).type, 'image/webp');
  assert.equal(photos.sniff(GIF), null);
  assert.equal(photos.ownFile(BASE + '/media/anna-nails/1793599200000-abcdefgh.jpg', BASE, 'anna-nails'), '1793599200000-abcdefgh.jpg');
  assert.equal(photos.ownFile(BASE + '/media/other/1793599200000-abcdefgh.jpg', BASE, 'anna-nails'), null);
  assert.equal(photos.ownFile(BASE + '/media/anna-nails/../x.jpg', BASE, 'anna-nails'), null);
  assert.equal(photos.ownFile('https://evil.test/media/anna-nails/1793599200000-abcdefgh.jpg', BASE, 'anna-nails'), null);
  assert.equal(validateSlug('media').ok, false);
  const many = Array.from({ length: 14 }, (_, i) => 'https://x.test/' + i + '.jpg');
  assert.equal(sanitizeProfile(profile({ gallery: many })).profile.gallery.length, 12);
});
