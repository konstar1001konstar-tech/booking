'use strict';

// Фото мастера, загруженные из галереи телефона.
// Браузер сжимает снимок (canvas, JPEG) и шлёт его сырым телом в
// POST /api/admin/photos?kind=avatar|gallery. Файл ложится в бакет под
// media/<slug>/<время>-<случайное>.<ext>; API Gateway отдаёт префикс media/
// публично (маршрут /media/{file+} в api/openapi.yaml). В профиле хранится
// обычная https-ссылка, поэтому старые ссылки на чужие сайты тоже работают.

const { HttpError } = require('./errors');
const { headerMap } = require('./http');
const { randomId } = require('./lib/session');

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_BYTES = 64;
const MAX_FILES = 30; // аватар + 12 в портфолио + запас на несохранённые замены
const GALLERY_MAX = 12;
const ORPHAN_GRACE_MS = 30 * 60 * 1000;
const UPLOAD_RATE = { windowMs: 60 * 60 * 1000, limit: 60 };
const FILE_RE = /^(\d{13})-[A-Za-z0-9_-]{6,24}\.(jpg|png|webp)$/;

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', type: 'image/png' };
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

function bodyBytes(event) {
  const body = event && event.body;
  if (body == null || body === '') return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (event.isBase64Encoded) return Buffer.from(String(body), 'base64');
  // JSON { data: "<base64>" } — запасной путь, если клиент не может слать бинарное тело.
  const type = String(headerMap(event)['content-type'] || '');
  if (/json/i.test(type)) {
    try {
      const parsed = JSON.parse(String(body));
      const data = String((parsed && parsed.data) || '').replace(/^data:[^,]*,/, '');
      return Buffer.from(data, 'base64');
    } catch (e) {
      throw new HttpError(400, 'validation', 'Не удалось прочитать фото.');
    }
  }
  return Buffer.from(String(body), 'latin1');
}

function mediaPrefix(slug) {
  return 'media/' + slug + '/';
}

function publicUrl(base, key) {
  return base + '/' + key;
}

// Имя файла из ссылки на наш /media/<slug>/..., иначе null.
function ownFile(url, base, slug) {
  const prefix = base + '/' + mediaPrefix(slug);
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const file = url.slice(prefix.length);
  return FILE_RE.test(file) ? file : null;
}

async function uploadPhoto(deps, master, event, query, limits) {
  if (!deps.repo.putMedia) throw new HttpError(503, 'not_configured', 'Загрузка фото здесь не настроена.');
  const kind = String((query && query.kind) || 'gallery');
  if (kind !== 'avatar' && kind !== 'gallery') throw new HttpError(400, 'validation', 'Неизвестный тип фото.');
  const buf = bodyBytes(event);
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'too_big', 'Фото слишком большое: до 2 МБ после сжатия.');
  if (buf.length < MIN_BYTES) throw new HttpError(400, 'validation', 'Файл пустой или повреждён.');
  const fmt = sniff(buf);
  if (!fmt) throw new HttpError(415, 'bad_type', 'Подходят только фото JPEG, PNG или WebP.');
  if (kind === 'gallery' && ((master.profile && master.profile.gallery) || []).length >= GALLERY_MAX) {
    // Сохранённое портфолио уже полное; клиент тоже не даёт добавить больше.
    throw new HttpError(409, 'too_many', 'В портфолио уже ' + GALLERY_MAX + ' фото. Удалите лишние и сохраните профиль.');
  }
  const now = deps.now ? deps.now() : new Date();
  const rule = (limits && limits.photo) || UPLOAD_RATE;
  const { tooMany } = require('./lib/rate');
  if (await tooMany(deps.repo, 'photo:' + master.slug, rule, now.getTime())) {
    throw new HttpError(429, 'rate_limited', 'Слишком много загрузок подряд. Попробуйте через час.');
  }
  const existing = await deps.repo.listMedia(mediaPrefix(master.slug));
  if (existing.length >= MAX_FILES) {
    throw new HttpError(409, 'too_many', 'Слишком много фото. Удалите лишние, сохраните профиль и попробуйте снова.');
  }
  const key = mediaPrefix(master.slug) + now.getTime() + '-' + randomId(9) + '.' + fmt.ext;
  await deps.repo.putMedia(key, buf, fmt.type);
  return { ok: true, url: publicUrl(event.base || '', key), kind, bytes: buf.length, type: fmt.type };
}

// После сохранения профиля: удалить файлы, которые выкинули из профиля, и
// несохранённые загрузки старше 30 минут. Ошибки не мешают сохранению.
async function cleanupPhotos(deps, slug, base, before, after) {
  if (!deps.repo.listMedia || !base) return 0;
  try {
    const now = (deps.now ? deps.now() : new Date()).getTime();
    const urls = (p) => [p && p.photo].concat((p && p.gallery) || []);
    const keep = new Set(urls(after).map((u) => ownFile(u, base, slug)).filter(Boolean));
    const dropped = new Set(urls(before).map((u) => ownFile(u, base, slug)).filter((f) => f && !keep.has(f)));
    const prefix = mediaPrefix(slug);
    const keys = await deps.repo.listMedia(prefix);
    let removed = 0;
    for (const key of keys) {
      const file = key.slice(prefix.length);
      if (keep.has(file)) continue;
      const m = FILE_RE.exec(file);
      const old = m && now - Number(m[1]) > ORPHAN_GRACE_MS;
      if (dropped.has(file) || old) {
        await deps.repo.deleteMedia(key);
        removed += 1;
      }
    }
    return removed;
  } catch (e) {
    console.warn('photo cleanup failed');
    return 0;
  }
}

async function deleteAllPhotos(deps, slug) {
  if (!deps.repo.listMedia) return 0;
  const keys = await deps.repo.listMedia(mediaPrefix(slug));
  for (const key of keys) await deps.repo.deleteMedia(key);
  return keys.length;
}

module.exports = { uploadPhoto, cleanupPhotos, deleteAllPhotos, sniff, ownFile, MAX_BYTES, GALLERY_MAX, MAX_FILES };
