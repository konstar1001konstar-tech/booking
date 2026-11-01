'use strict';

const { RepoError } = require('../errors');

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

class MemoryRepo {
  constructor() {
    this.masters = new Map();
    this.byChat = new Map();
    this.bookings = new Map();
    this.holds = new Map();
    this.rates = new Map();
    this.logins = new Map();
    this.botState = new Map();
    this.outbox = new Map();
    this.media = new Map();
    this.idents = new Map();
    this.sweeps = new Set();
    this._ver = 0;
    this._chain = Promise.resolve();
  }

  _lock(fn) {
    const run = this._chain.then(() => fn());
    this._chain = run.then(() => undefined, () => undefined);
    return run;
  }

  getMasterBySlug(slug) {
    return this._lock(() => clone(this.masters.get(slug)));
  }

  getMasterByChat(chatId) {
    return this._lock(() => {
      const slug = this.byChat.get(String(chatId));
      return slug ? clone(this.masters.get(slug)) : null;
    });
  }

  insertMaster(master) {
    return this._lock(() => {
      if (this.masters.has(master.slug)) throw new RepoError('slug_taken');
      const chat = master.chatId ? String(master.chatId) : '';
      if (chat && this.byChat.has(chat)) throw new RepoError('chat_taken');
      this.masters.set(master.slug, clone(master));
      if (chat) this.byChat.set(chat, master.slug);
      return clone(master);
    });
  }

  updateMasterProfile(slug, profile, published, updatedAt) {
    return this._lock(() => {
      const row = this.masters.get(slug);
      if (!row) throw new RepoError('not_found');
      row.profile = clone(profile);
      row.published = Boolean(published);
      row.updatedAt = updatedAt;
      return clone(row);
    });
  }

  listBusy(slug, from, to) {
    return this._lock(() => {
      const start = from + 'T00:00';
      const end = to + 'T23:59';
      const out = [];
      for (const [key] of this.holds) {
        const split = key.indexOf('\n');
        const owner = key.slice(0, split);
        const slot = key.slice(split + 1);
        if (owner === slug && slot >= start && slot <= end) out.push(slot);
      }
      return out;
    });
  }

  createBooking(booking) {
    return this._lock(() => {
      const key = booking.slug + '\n' + booking.slotKey;
      if (this.holds.has(key)) throw new RepoError('slot_taken');
      if (this.bookings.has(booking.id)) throw new RepoError('exists');
      this.bookings.set(booking.id, clone(booking));
      this.holds.set(key, booking.id);
      return clone(booking);
    });
  }

  listBookings(slug, limit) {
    const max = limit == null ? 100 : limit;
    return this._lock(() => {
      const rows = [];
      for (const row of this.bookings.values()) {
        if (row.slug === slug) rows.push(clone(row));
      }
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return rows.slice(0, max);
    });
  }

  getBooking(id) {
    return this._lock(() => clone(this.bookings.get(id)));
  }

  setBookingStatus(id, status, updatedAt) {
    return this._lock(() => {
      const row = this.bookings.get(id);
      if (!row) throw new RepoError('not_found');
      if (row.status === 'cancelled' && status !== 'cancelled') throw new RepoError('closed');
      row.status = status;
      row.updatedAt = updatedAt;
      if (status === 'cancelled') this.holds.delete(row.slug + '\n' + row.slotKey);
      return clone(row);
    });
  }

  setMessageId(id, messageId) {
    return this._lock(() => {
      const row = this.bookings.get(id);
      if (!row) return null;
      row.tgMessageId = String(messageId || '');
      return clone(row);
    });
  }

  deleteBooking(id) {
    return this._lock(() => {
      const row = this.bookings.get(id);
      if (!row) throw new RepoError('not_found');
      this.holds.delete(row.slug + '\n' + row.slotKey);
      this.bookings.delete(id);
      return true;
    });
  }

  addRate(bucket, windowStart) {
    return this._lock(() => {
      const key = bucket + '\n' + windowStart;
      const next = (this.rates.get(key) || 0) + 1;
      this.rates.set(key, next);
      return next;
    });
  }

  putLogin(jti, record) {
    return this._lock(() => {
      this.logins.set(jti, clone(record));
    });
  }

  consumeLogin(jti, nowMs) {
    return this._lock(() => {
      const row = this.logins.get(jti);
      if (!row) return null;
      this.logins.delete(jti);
      if (row.exp < nowMs) return null;
      return clone(row);
    });
  }

  getBotState(chatId) {
    return this._lock(() => this.botState.get(String(chatId)) || '');
  }

  setBotState(chatId, step) {
    return this._lock(() => {
      if (!step) this.botState.delete(String(chatId));
      else this.botState.set(String(chatId), step);
    });
  }
}

Object.assign(MemoryRepo.prototype, {
  patchMaster(slug, fields) {
    return this._lock(() => {
      const row = this.masters.get(slug);
      if (!row) throw new RepoError('not_found');
      const patch = typeof fields === 'function' ? fields(clone(row)) : fields;
      Object.assign(row, clone(patch));
      return clone(row);
    });
  },
  getIdentity(provider, sub) {
    return this._lock(() => this.idents.get(provider + '\n' + sub) || null);
  },
  putIdentity(provider, sub, slug) {
    return this._lock(() => {
      const key = provider + '\n' + sub;
      if (this.idents.has(key)) return this.idents.get(key) === slug;
      this.idents.set(key, slug);
      return true;
    });
  },
  deleteIdentity(provider, sub) {
    return this._lock(() => { this.idents.delete(provider + '\n' + sub); });
  },
  linkChat(slug, chatId) {
    return this._lock(() => {
      const chat = String(chatId);
      const row = this.masters.get(slug);
      if (!row) throw new RepoError('not_found');
      const owner = this.byChat.get(chat);
      if (owner && owner !== slug) throw new RepoError('chat_taken');
      const previous = row.chatId ? String(row.chatId) : '';
      if (previous && previous !== chat && this.byChat.get(previous) === slug) this.byChat.delete(previous);
      this.byChat.set(chat, slug);
      row.chatId = chat;
      return clone(row);
    });
  },
  listMasterSlugs() {
    return this._lock(() => [...this.masters.keys()].sort());
  },
  claimOnce(day) {
    return this._lock(() => {
      if (this.sweeps.has(day)) return false;
      this.sweeps.add(day);
      return true;
    });
  },
  putOutbox(item) {
    return this._lock(() => {
      this._ver += 1;
      this.outbox.set(item.id, { value: clone(item), etag: 'v' + this._ver });
    });
  },
  listOutbox() {
    return this._lock(() => [...this.outbox.keys()].sort());
  },
  getOutbox(id) {
    return this._lock(() => {
      const row = this.outbox.get(id);
      return row ? { value: clone(row.value), etag: row.etag } : null;
    });
  },
  claimOutbox(id, value, etag) {
    return this._lock(() => {
      const row = this.outbox.get(id);
      if (!row || row.etag !== etag) return null;
      this._ver += 1;
      const next = { value: clone(value), etag: 'v' + this._ver };
      this.outbox.set(id, next);
      return next.etag;
    });
  },
  deleteOutbox(id) {
    return this._lock(() => {
      this.outbox.delete(id);
    });
  },
  putMedia(key, buf, type) {
    return this._lock(() => {
      this.media.set(key, { buf: Buffer.from(buf), type });
    });
  },
  listMedia(prefix) {
    return this._lock(() => [...this.media.keys()].filter((k) => k.startsWith(prefix)).sort());
  },
  deleteMedia(key) {
    return this._lock(() => {
      this.media.delete(key);
    });
  }
});

module.exports = { MemoryRepo };
