'use strict';

// Хранилище в Object Storage (S3 API Yandex Cloud) вместо YDB.
// Каждый мастер, заявка, бронь слота и т.п. — отдельный JSON-объект под
// префиксом data/ в закрытом бакете. Уникальность слота и адреса мастера
// держится на условной записи If-None-Match: * (Object Storage отвечает 412,
// если объект уже есть). Счётчики лимитов — через If-Match по ETag.
//
// Раскладка ключей:
//   data/masters/<slug>.json            мастер
//   data/chats/<chat_id>.json           { slug }
//   data/bookings/<slug>/<created>_<id>.json  заявка
//   data/booking-ids/<id>.json          { slug, key }
//   data/holds/<slug>/<slot_key>.json   { bookingId }
//   data/rates/<bucket>/<window>.json   число
//   data/logins/<jti>.json              одноразовый вход
//   data/bot-state/<chat_id>.json       { step }
//   data/outbox/<id>.json               неотправленное сообщение Telegram

const { RepoError } = require('../errors');

const DEFAULT_ENDPOINT = 'https://storage.yandexcloud.net';

function enc(part) {
  return encodeURIComponent(String(part));
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function xmlValues(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  return out;
}

// Минимальный клиент S3 на fetch. Авторизация — IAM-токеном в заголовке
// X-YaCloud-SubjectToken (так Object Storage принимает токен сервисного
// аккаунта функции без статических ключей).
class S3Store {
  constructor(opts) {
    const o = opts || {};
    this.bucket = o.bucket;
    this.endpoint = (o.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
    this.getToken = o.getToken;
    this.fetch = o.fetch || ((...args) => fetch(...args));
    this.timeoutMs = o.timeoutMs || 5000;
    if (!this.bucket) throw new Error('S3 bucket is required');
  }

  _url(key, query) {
    const path = key == null ? '' : '/' + String(key).split('/').map(encodeURIComponent).join('/');
    return this.endpoint + '/' + encodeURIComponent(this.bucket) + path + (query ? '?' + query : '');
  }

  async _req(method, key, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    const token = await this.getToken();
    if (token) headers['X-YaCloud-SubjectToken'] = token;
    const init = { method, headers };
    if (o.body != null) init.body = o.body;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetch(this._url(key, o.query), init);
    return res;
  }

  async get(key) {
    const res = await this._req('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('s3 get ' + res.status);
    const text = await res.text();
    return { value: JSON.parse(text), etag: res.headers.get('etag') || '' };
  }

  // mode: undefined (перезапись), 'create' (только если нет), или etag (только если не менялся).
  async put(key, value, mode) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (mode === 'create') headers['If-None-Match'] = '*';
    else if (mode) headers['If-Match'] = mode;
    const res = await this._req('PUT', key, { headers, body: JSON.stringify(value) });
    if (res.status === 412 || res.status === 409) return false;
    if (!res.ok) throw new Error('s3 put ' + res.status);
    return res.headers.get('etag') || true;
  }

  async putRaw(key, buf, type, cacheControl) {
    const headers = { 'Content-Type': type };
    if (cacheControl) headers['Cache-Control'] = cacheControl;
    const res = await this._req('PUT', key, { headers, body: buf });
    if (!res.ok) throw new Error('s3 put ' + res.status);
    return true;
  }

  async del(key) {
    const res = await this._req('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error('s3 delete ' + res.status);
    return true;
  }

  async list(prefix) {
    const keys = [];
    let token = '';
    for (let page = 0; page < 50; page += 1) {
      const q = 'list-type=2&prefix=' + encodeURIComponent(prefix) + (token ? '&continuation-token=' + encodeURIComponent(token) : '');
      const res = await this._req('GET', null, { query: q });
      if (!res.ok) throw new Error('s3 list ' + res.status);
      const xml = await res.text();
      keys.push(...xmlValues(xml, 'Key'));
      const next = xmlValues(xml, 'NextContinuationToken')[0];
      if (!next || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = next;
    }
    return keys;
  }
}

const K = {
  master: (slug) => 'data/masters/' + enc(slug) + '.json',
  chat: (chatId) => 'data/chats/' + enc(chatId) + '.json',
  bookingPrefix: (slug) => 'data/bookings/' + enc(slug) + '/',
  booking: (slug, createdAt, id) => 'data/bookings/' + enc(slug) + '/' + enc(createdAt) + '_' + enc(id) + '.json',
  bookingId: (id) => 'data/booking-ids/' + enc(id) + '.json',
  holdPrefix: (slug) => 'data/holds/' + enc(slug) + '/',
  hold: (slug, slotKey) => 'data/holds/' + enc(slug) + '/' + enc(slotKey) + '.json',
  rate: (bucket, windowStart) => 'data/rates/' + enc(bucket) + '/' + enc(windowStart) + '.json',
  login: (jti) => 'data/logins/' + enc(jti) + '.json',
  botState: (chatId) => 'data/bot-state/' + enc(chatId) + '.json',
  outboxPrefix: () => 'data/outbox/',
  outbox: (id) => 'data/outbox/' + enc(id) + '.json'
};

class S3Repo {
  constructor(opts) {
    const o = opts || {};
    this.store = o.store || new S3Store(o);
  }

  async getMasterBySlug(slug) {
    const row = await this.store.get(K.master(slug));
    return row ? clone(row.value) : null;
  }

  async getMasterByChat(chatId) {
    const link = await this.store.get(K.chat(chatId));
    if (!link || !link.value || !link.value.slug) return null;
    return this.getMasterBySlug(link.value.slug);
  }

  async insertMaster(master) {
    if (await this.store.get(K.master(master.slug))) throw new RepoError('slug_taken');
    if (!(await this.store.put(K.chat(master.chatId), { slug: master.slug }, 'create'))) {
      throw new RepoError('chat_taken');
    }
    if (!(await this.store.put(K.master(master.slug), master, 'create'))) {
      await this.store.del(K.chat(master.chatId));
      throw new RepoError('slug_taken');
    }
    return clone(master);
  }

  async updateMasterProfile(slug, profile, published, updatedAt) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await this.store.get(K.master(slug));
      if (!row) throw new RepoError('not_found');
      const next = Object.assign({}, row.value, { profile: clone(profile), published: Boolean(published), updatedAt });
      if (await this.store.put(K.master(slug), next, row.etag || undefined)) return clone(next);
    }
    throw new RepoError('conflict');
  }

  async listBusy(slug, from, to) {
    const prefix = K.holdPrefix(slug);
    const start = from + 'T00:00';
    const end = to + 'T23:59';
    const keys = await this.store.list(prefix);
    const out = [];
    for (const key of keys) {
      const slot = decodeURIComponent(key.slice(prefix.length).replace(/\.json$/, ''));
      if (slot >= start && slot <= end) out.push(slot);
    }
    return out;
  }

  async createBooking(booking) {
    const holdKey = K.hold(booking.slug, booking.slotKey);
    if (!(await this.store.put(holdKey, { bookingId: booking.id }, 'create'))) throw new RepoError('slot_taken');
    const key = K.booking(booking.slug, booking.createdAt, booking.id);
    if (!(await this.store.put(K.bookingId(booking.id), { slug: booking.slug, key }, 'create'))) {
      await this.store.del(holdKey);
      throw new RepoError('exists');
    }
    await this.store.put(key, booking);
    return clone(booking);
  }

  async listBookings(slug) {
    const keys = (await this.store.list(K.bookingPrefix(slug))).sort().reverse().slice(0, 100);
    const rows = await Promise.all(keys.map((key) => this.store.get(key)));
    const out = rows.filter(Boolean).map((r) => clone(r.value));
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return out;
  }

  async _bookingRow(id) {
    const link = await this.store.get(K.bookingId(id));
    if (!link || !link.value || !link.value.key) return null;
    const row = await this.store.get(link.value.key);
    return row ? { key: link.value.key, value: row.value, etag: row.etag } : null;
  }

  async getBooking(id) {
    const row = await this._bookingRow(id);
    return row ? clone(row.value) : null;
  }

  async _releaseHold(row) {
    const holdKey = K.hold(row.slug, row.slotKey);
    const hold = await this.store.get(holdKey);
    if (hold && hold.value && hold.value.bookingId === row.id) await this.store.del(holdKey);
  }

  async setBookingStatus(id, status, updatedAt) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await this._bookingRow(id);
      if (!row) throw new RepoError('not_found');
      if (row.value.status === 'cancelled' && status !== 'cancelled') throw new RepoError('closed');
      const next = Object.assign({}, row.value, { status, updatedAt });
      if (await this.store.put(row.key, next, row.etag || undefined)) {
        if (status === 'cancelled') await this._releaseHold(next);
        return clone(next);
      }
    }
    throw new RepoError('conflict');
  }

  async setMessageId(id, messageId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await this._bookingRow(id);
      if (!row) return null;
      const next = Object.assign({}, row.value, { tgMessageId: String(messageId || '') });
      if (await this.store.put(row.key, next, row.etag || undefined)) return clone(next);
    }
    return null;
  }

  async deleteBooking(id) {
    const row = await this._bookingRow(id);
    if (!row) throw new RepoError('not_found');
    await this._releaseHold(row.value);
    await this.store.del(row.key);
    await this.store.del(K.bookingId(id));
    return true;
  }

  async addRate(bucket, windowStart) {
    const key = K.rate(bucket, windowStart);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const row = await this.store.get(key);
      const next = (row ? Number(row.value) || 0 : 0) + 1;
      if (await this.store.put(key, next, row ? (row.etag || undefined) : 'create')) return next;
    }
    // Под сильной гонкой лимит не должен ронять заявку: считаем, что это ещё одна попытка.
    return 1;
  }

  async putLogin(jti, record) {
    await this.store.put(K.login(jti), record, 'create');
  }

  async consumeLogin(jti, nowMs) {
    const key = K.login(jti);
    const row = await this.store.get(key);
    if (!row) return null;
    await this.store.del(key);
    if (row.value.exp < nowMs) return null;
    return clone(row.value);
  }

  async getBotState(chatId) {
    const row = await this.store.get(K.botState(chatId));
    return row && row.value ? row.value.step || '' : '';
  }

  async setBotState(chatId, step) {
    if (!step) await this.store.del(K.botState(chatId));
    else await this.store.put(K.botState(chatId), { step });
  }
}

Object.assign(S3Repo.prototype, {
  async putOutbox(item) {
    await this.store.put(K.outbox(item.id), item);
  },

  async listOutbox() {
    const prefix = K.outboxPrefix();
    const keys = await this.store.list(prefix);
    return keys.map((key) => decodeURIComponent(key.slice(prefix.length).replace(/\.json$/, '')));
  },

  async getOutbox(id) {
    const row = await this.store.get(K.outbox(id));
    return row ? { value: clone(row.value), etag: row.etag } : null;
  },

  // Условная запись по ETag. Возвращает новый ETag или null, если запись
  // успел изменить кто-то другой (или её удалили).
  async claimOutbox(id, value, etag) {
    const key = K.outbox(id);
    if (!etag) return null;
    const res = await this.store.put(key, value, etag);
    if (!res) return null;
    if (typeof res === 'string') return res;
    const row = await this.store.get(key);
    return row ? row.etag || null : null;
  },

  async deleteOutbox(id) {
    await this.store.del(K.outbox(id));
  },

  // Фото мастеров: media/<slug>/<file>, вне data/, отдаются через API Gateway.
  async putMedia(key, buf, type) {
    if (!/^media\//.test(key)) throw new Error('bad media key');
    await this.store.putRaw(key, buf, type, 'public, max-age=31536000, immutable');
  },

  async listMedia(prefix) {
    return this.store.list(prefix);
  },

  async deleteMedia(key) {
    if (!/^media\//.test(key)) throw new Error('bad media key');
    await this.store.del(key);
  }
});

module.exports = { S3Repo, S3Store, keys: K };
