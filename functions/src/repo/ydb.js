'use strict';

const { RepoError } = require('../errors');

let driverPromise = null;
let sdk = null;

function loadSdk() {
  if (!sdk) sdk = require('ydb-sdk');
  return sdk;
}

function ydbEndpoint() {
  let endpoint = process.env.YDB_ENDPOINT || '';
  let database = process.env.YDB_DATABASE || '';
  if (endpoint.includes('?database=')) {
    const url = new URL(endpoint);
    database = database || url.searchParams.get('database') || '';
    endpoint = url.protocol + '//' + url.host;
  }
  if (endpoint && !/^grpcs?:\/\//.test(endpoint)) endpoint = 'grpcs://' + endpoint;
  if (!endpoint || !database) {
    throw new Error('YDB_ENDPOINT and YDB_DATABASE are required');
  }
  return { endpoint, database };
}

function getDriver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      const { Driver, getCredentialsFromEnv } = loadSdk();
      const { endpoint, database } = ydbEndpoint();
      const driver = new Driver({
        endpoint,
        database,
        authService: getCredentialsFromEnv()
      });
      if (!(await driver.ready(10000))) throw new Error('YDB driver is not ready');
      return driver;
    })();
    driverPromise.catch(() => { driverPromise = null; });
  }
  return driverPromise;
}

function isAbort(err) {
  const code = err && (err.code || err.statusCode);
  return code === 400020 || code === 'ABORTED' || /ABORTED/i.test(String(err && err.message));
}

function paramsOf(fields) {
  const { TypedValues } = loadSdk();
  const out = {};
  for (const [key, spec] of Object.entries(fields)) {
    if (spec.t === 'bool') out['$' + key] = TypedValues.bool(Boolean(spec.v));
    else if (spec.t === 'u32') out['$' + key] = TypedValues.uint32(Number(spec.v) || 0);
    else out['$' + key] = TypedValues.utf8(String(spec.v == null ? '' : spec.v));
  }
  return out;
}

async function rowsOf(session, txId, sql, fields) {
  const { TypedData } = loadSdk();
  const res = await session.executeQuery(sql, paramsOf(fields), { txId });
  const set = res && res.resultSets && res.resultSets[0];
  if (!set) return [];
  return TypedData.createNativeObjects(set);
}

async function exec(session, txId, sql, fields) {
  await session.executeQuery(sql, paramsOf(fields), { txId });
}

async function withTx(fn) {
  const driver = await getDriver();
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await driver.tableClient.withSession(async (session) => {
        const meta = await session.beginTransaction({ serializableReadWrite: {} });
        const txId = meta.id;
        try {
          const value = await fn(session, txId);
          await session.commitTransaction({ txId });
          return value;
        } catch (err) {
          try { await session.rollbackTransaction({ txId }); } catch (e) { /* транзакция уже закрыта */ }
          throw err;
        }
      });
    } catch (err) {
      last = err;
      if (!isAbort(err) || attempt === 2) throw err;
    }
  }
  throw last;
}

function masterFrom(row) {
  if (!row) return null;
  let profile = {};
  try { profile = JSON.parse(row.profile_json || '{}'); } catch (e) { profile = {}; }
  return {
    slug: row.slug,
    chatId: row.chat_id,
    telegramUserId: row.telegram_user_id,
    published: Boolean(row.published),
    profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function bookingFrom(row) {
  if (!row) return null;
  return {
    id: row.booking_id,
    slug: row.slug,
    slotKey: row.slot_key,
    date: row.date_iso,
    time: row.time_hhmm,
    dateText: row.date_text,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    serviceName: row.service_name,
    servicePrice: Number(row.service_price) || 0,
    serviceDur: row.service_dur || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    tgMessageId: row.tg_message_id || ''
  };
}

function bookingFields(b) {
  return {
    slug: { t: 'utf8', v: b.slug },
    created_at: { t: 'utf8', v: b.createdAt },
    booking_id: { t: 'utf8', v: b.id },
    slot_key: { t: 'utf8', v: b.slotKey },
    client_name: { t: 'utf8', v: b.clientName },
    client_phone: { t: 'utf8', v: b.clientPhone },
    service_name: { t: 'utf8', v: b.serviceName },
    service_price: { t: 'u32', v: b.servicePrice },
    service_dur: { t: 'utf8', v: b.serviceDur || '' },
    date_iso: { t: 'utf8', v: b.date },
    time_hhmm: { t: 'utf8', v: b.time },
    date_text: { t: 'utf8', v: b.dateText || '' },
    status: { t: 'utf8', v: b.status },
    tg_message_id: { t: 'utf8', v: b.tgMessageId || '' },
    updated_at: { t: 'utf8', v: b.updatedAt || b.createdAt }
  };
}

const MASTER_COLS = 'slug, chat_id, telegram_user_id, profile_json, published, created_at, updated_at';

class YdbRepo {
  getMasterBySlug(slug) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        SELECT ${MASTER_COLS} FROM masters WHERE slug = $slug;
      `, { slug: { t: 'utf8', v: slug } });
      return masterFrom(rows[0]);
    });
  }

  getMasterByChat(chatId) {
    return withTx(async (session, txId) => {
      const found = await rowsOf(session, txId, `
        DECLARE $chat_id AS Utf8;
        SELECT slug FROM masters_by_chat WHERE chat_id = $chat_id;
      `, { chat_id: { t: 'utf8', v: String(chatId) } });
      if (!found[0]) return null;
      const rows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        SELECT ${MASTER_COLS} FROM masters WHERE slug = $slug;
      `, { slug: { t: 'utf8', v: found[0].slug } });
      return masterFrom(rows[0]);
    });
  }

  insertMaster(master) {
    return withTx(async (session, txId) => {
      const slugRows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        SELECT slug FROM masters WHERE slug = $slug;
      `, { slug: { t: 'utf8', v: master.slug } });
      if (slugRows[0]) throw new RepoError('slug_taken');
      const chatRows = await rowsOf(session, txId, `
        DECLARE $chat_id AS Utf8;
        SELECT chat_id FROM masters_by_chat WHERE chat_id = $chat_id;
      `, { chat_id: { t: 'utf8', v: String(master.chatId) } });
      if (chatRows[0]) throw new RepoError('chat_taken');
      const fields = {
        slug: { t: 'utf8', v: master.slug },
        chat_id: { t: 'utf8', v: String(master.chatId) },
        telegram_user_id: { t: 'utf8', v: String(master.telegramUserId || master.chatId) },
        profile_json: { t: 'utf8', v: JSON.stringify(master.profile || {}) },
        published: { t: 'bool', v: Boolean(master.published) },
        created_at: { t: 'utf8', v: master.createdAt },
        updated_at: { t: 'utf8', v: master.updatedAt }
      };
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $chat_id AS Utf8;
        DECLARE $telegram_user_id AS Utf8;
        DECLARE $profile_json AS Utf8;
        DECLARE $published AS Bool;
        DECLARE $created_at AS Utf8;
        DECLARE $updated_at AS Utf8;
        INSERT INTO masters (${MASTER_COLS})
        VALUES ($slug, $chat_id, $telegram_user_id, $profile_json, $published, $created_at, $updated_at);
      `, fields);
      await exec(session, txId, `
        DECLARE $chat_id AS Utf8;
        DECLARE $slug AS Utf8;
        INSERT INTO masters_by_chat (chat_id, slug) VALUES ($chat_id, $slug);
      `, { chat_id: fields.chat_id, slug: fields.slug });
      return master;
    });
  }

  updateMasterProfile(slug, profile, published, updatedAt) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        SELECT slug FROM masters WHERE slug = $slug;
      `, { slug: { t: 'utf8', v: slug } });
      if (!rows[0]) throw new RepoError('not_found');
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $profile_json AS Utf8;
        DECLARE $published AS Bool;
        DECLARE $updated_at AS Utf8;
        UPDATE masters SET profile_json = $profile_json, published = $published, updated_at = $updated_at
        WHERE slug = $slug;
      `, {
        slug: { t: 'utf8', v: slug },
        profile_json: { t: 'utf8', v: JSON.stringify(profile) },
        published: { t: 'bool', v: Boolean(published) },
        updated_at: { t: 'utf8', v: updatedAt }
      });
      return { slug, profile, published: Boolean(published), updatedAt };
    });
  }

  listBusy(slug, from, to) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $from_key AS Utf8;
        DECLARE $to_key AS Utf8;
        SELECT slot_key FROM slot_holds
        WHERE slug = $slug AND slot_key >= $from_key AND slot_key <= $to_key;
      `, {
        slug: { t: 'utf8', v: slug },
        from_key: { t: 'utf8', v: from + 'T00:00' },
        to_key: { t: 'utf8', v: to + 'T23:59' }
      });
      return rows.map((row) => row.slot_key);
    });
  }

  createBooking(booking) {
    return withTx(async (session, txId) => {
      const holds = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $slot_key AS Utf8;
        SELECT booking_id FROM slot_holds WHERE slug = $slug AND slot_key = $slot_key;
      `, {
        slug: { t: 'utf8', v: booking.slug },
        slot_key: { t: 'utf8', v: booking.slotKey }
      });
      if (holds[0]) throw new RepoError('slot_taken');
      const fields = bookingFields(booking);
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $booking_id AS Utf8;
        DECLARE $slot_key AS Utf8;
        DECLARE $client_name AS Utf8;
        DECLARE $client_phone AS Utf8;
        DECLARE $service_name AS Utf8;
        DECLARE $service_price AS Uint32;
        DECLARE $service_dur AS Utf8;
        DECLARE $date_iso AS Utf8;
        DECLARE $time_hhmm AS Utf8;
        DECLARE $date_text AS Utf8;
        DECLARE $status AS Utf8;
        DECLARE $tg_message_id AS Utf8;
        DECLARE $updated_at AS Utf8;
        INSERT INTO bookings (
          slug, created_at, booking_id, slot_key, client_name, client_phone, service_name,
          service_price, service_dur, date_iso, time_hhmm, date_text, status, tg_message_id, updated_at
        ) VALUES (
          $slug, $created_at, $booking_id, $slot_key, $client_name, $client_phone, $service_name,
          $service_price, $service_dur, $date_iso, $time_hhmm, $date_text, $status, $tg_message_id, $updated_at
        );
      `, fields);
      await exec(session, txId, `
        DECLARE $booking_id AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $slot_key AS Utf8;
        DECLARE $client_name AS Utf8;
        DECLARE $client_phone AS Utf8;
        DECLARE $service_name AS Utf8;
        DECLARE $service_price AS Uint32;
        DECLARE $service_dur AS Utf8;
        DECLARE $date_iso AS Utf8;
        DECLARE $time_hhmm AS Utf8;
        DECLARE $date_text AS Utf8;
        DECLARE $status AS Utf8;
        DECLARE $tg_message_id AS Utf8;
        DECLARE $updated_at AS Utf8;
        INSERT INTO bookings_by_id (
          booking_id, slug, created_at, slot_key, client_name, client_phone, service_name,
          service_price, service_dur, date_iso, time_hhmm, date_text, status, tg_message_id, updated_at
        ) VALUES (
          $booking_id, $slug, $created_at, $slot_key, $client_name, $client_phone, $service_name,
          $service_price, $service_dur, $date_iso, $time_hhmm, $date_text, $status, $tg_message_id, $updated_at
        );
      `, fields);
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $slot_key AS Utf8;
        DECLARE $booking_id AS Utf8;
        INSERT INTO slot_holds (slug, slot_key, booking_id) VALUES ($slug, $slot_key, $booking_id);
      `, {
        slug: fields.slug,
        slot_key: fields.slot_key,
        booking_id: fields.booking_id
      });
      return booking;
    });
  }

  listBookings(slug) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $slug AS Utf8;
        SELECT booking_id, slug, created_at, slot_key, client_name, client_phone, service_name,
               service_price, service_dur, date_iso, time_hhmm, date_text, status, tg_message_id, updated_at
        FROM bookings WHERE slug = $slug;
      `, { slug: { t: 'utf8', v: slug } });
      return rows.map(bookingFrom)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, 100);
    });
  }

  getBooking(id) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $booking_id AS Utf8;
        SELECT booking_id, slug, created_at, slot_key, client_name, client_phone, service_name,
               service_price, service_dur, date_iso, time_hhmm, date_text, status, tg_message_id, updated_at
        FROM bookings_by_id WHERE booking_id = $booking_id;
      `, { booking_id: { t: 'utf8', v: id } });
      return bookingFrom(rows[0]);
    });
  }

  setBookingStatus(id, status, updatedAt) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $booking_id AS Utf8;
        SELECT booking_id, slug, created_at, slot_key, status FROM bookings_by_id WHERE booking_id = $booking_id;
      `, { booking_id: { t: 'utf8', v: id } });
      const row = rows[0];
      if (!row) throw new RepoError('not_found');
      if (row.status === 'cancelled' && status !== 'cancelled') throw new RepoError('closed');
      const fields = {
        booking_id: { t: 'utf8', v: id },
        slug: { t: 'utf8', v: row.slug },
        created_at: { t: 'utf8', v: row.created_at },
        status: { t: 'utf8', v: status },
        updated_at: { t: 'utf8', v: updatedAt }
      };
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $booking_id AS Utf8;
        DECLARE $status AS Utf8;
        DECLARE $updated_at AS Utf8;
        UPDATE bookings SET status = $status, updated_at = $updated_at
        WHERE slug = $slug AND created_at = $created_at AND booking_id = $booking_id;
      `, fields);
      await exec(session, txId, `
        DECLARE $booking_id AS Utf8;
        DECLARE $status AS Utf8;
        DECLARE $updated_at AS Utf8;
        UPDATE bookings_by_id SET status = $status, updated_at = $updated_at
        WHERE booking_id = $booking_id;
      `, fields);
      if (status === 'cancelled') {
        await exec(session, txId, `
          DECLARE $slug AS Utf8;
          DECLARE $slot_key AS Utf8;
          DELETE FROM slot_holds WHERE slug = $slug AND slot_key = $slot_key;
        `, { slug: fields.slug, slot_key: { t: 'utf8', v: row.slot_key } });
      }
      return true;
    });
  }

  setMessageId(id, messageId) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $booking_id AS Utf8;
        SELECT slug, created_at FROM bookings_by_id WHERE booking_id = $booking_id;
      `, { booking_id: { t: 'utf8', v: id } });
      if (!rows[0]) return null;
      const fields = {
        booking_id: { t: 'utf8', v: id },
        slug: { t: 'utf8', v: rows[0].slug },
        created_at: { t: 'utf8', v: rows[0].created_at },
        tg_message_id: { t: 'utf8', v: String(messageId || '') }
      };
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $booking_id AS Utf8;
        DECLARE $tg_message_id AS Utf8;
        UPDATE bookings SET tg_message_id = $tg_message_id
        WHERE slug = $slug AND created_at = $created_at AND booking_id = $booking_id;
      `, fields);
      await exec(session, txId, `
        DECLARE $booking_id AS Utf8;
        DECLARE $tg_message_id AS Utf8;
        UPDATE bookings_by_id SET tg_message_id = $tg_message_id WHERE booking_id = $booking_id;
      `, fields);
      return true;
    });
  }

  deleteBooking(id) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $booking_id AS Utf8;
        SELECT slug, created_at, slot_key FROM bookings_by_id WHERE booking_id = $booking_id;
      `, { booking_id: { t: 'utf8', v: id } });
      if (!rows[0]) throw new RepoError('not_found');
      const fields = {
        booking_id: { t: 'utf8', v: id },
        slug: { t: 'utf8', v: rows[0].slug },
        created_at: { t: 'utf8', v: rows[0].created_at },
        slot_key: { t: 'utf8', v: rows[0].slot_key }
      };
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $created_at AS Utf8;
        DECLARE $booking_id AS Utf8;
        DELETE FROM bookings WHERE slug = $slug AND created_at = $created_at AND booking_id = $booking_id;
      `, fields);
      await exec(session, txId, `
        DECLARE $booking_id AS Utf8;
        DELETE FROM bookings_by_id WHERE booking_id = $booking_id;
      `, fields);
      await exec(session, txId, `
        DECLARE $slug AS Utf8;
        DECLARE $slot_key AS Utf8;
        DELETE FROM slot_holds WHERE slug = $slug AND slot_key = $slot_key;
      `, fields);
      return true;
    });
  }

  addRate(bucket, windowStart) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $bucket AS Utf8;
        DECLARE $window_start AS Utf8;
        SELECT count FROM rate_limits WHERE bucket = $bucket AND window_start = $window_start;
      `, {
        bucket: { t: 'utf8', v: bucket },
        window_start: { t: 'utf8', v: windowStart }
      });
      const count = (rows[0] ? Number(rows[0].count) : 0) + 1;
      await exec(session, txId, `
        DECLARE $bucket AS Utf8;
        DECLARE $window_start AS Utf8;
        DECLARE $count AS Uint32;
        UPSERT INTO rate_limits (bucket, window_start, count) VALUES ($bucket, $window_start, $count);
      `, {
        bucket: { t: 'utf8', v: bucket },
        window_start: { t: 'utf8', v: windowStart },
        count: { t: 'u32', v: count }
      });
      return count;
    });
  }

  putLogin(jti, record) {
    return withTx(async (session, txId) => {
      await exec(session, txId, `
        DECLARE $jti AS Utf8;
        DECLARE $slug AS Utf8;
        DECLARE $chat_id AS Utf8;
        DECLARE $exp AS Utf8;
        UPSERT INTO login_tokens (jti, slug, chat_id, exp) VALUES ($jti, $slug, $chat_id, $exp);
      `, {
        jti: { t: 'utf8', v: jti },
        slug: { t: 'utf8', v: record.slug },
        chat_id: { t: 'utf8', v: String(record.chatId) },
        exp: { t: 'utf8', v: String(record.exp) }
      });
    });
  }

  consumeLogin(jti, nowMs) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $jti AS Utf8;
        SELECT jti, slug, chat_id, exp FROM login_tokens WHERE jti = $jti;
      `, { jti: { t: 'utf8', v: jti } });
      if (!rows[0]) return null;
      await exec(session, txId, `
        DECLARE $jti AS Utf8;
        DELETE FROM login_tokens WHERE jti = $jti;
      `, { jti: { t: 'utf8', v: jti } });
      if (Number(rows[0].exp) < nowMs) return null;
      return { slug: rows[0].slug, chatId: rows[0].chat_id, exp: Number(rows[0].exp) };
    });
  }

  getBotState(chatId) {
    return withTx(async (session, txId) => {
      const rows = await rowsOf(session, txId, `
        DECLARE $chat_id AS Utf8;
        SELECT step FROM bot_state WHERE chat_id = $chat_id;
      `, { chat_id: { t: 'utf8', v: String(chatId) } });
      return rows[0] ? rows[0].step : '';
    });
  }

  setBotState(chatId, step) {
    return withTx(async (session, txId) => {
      if (!step) {
        await exec(session, txId, `
          DECLARE $chat_id AS Utf8;
          DELETE FROM bot_state WHERE chat_id = $chat_id;
        `, { chat_id: { t: 'utf8', v: String(chatId) } });
        return;
      }
      await exec(session, txId, `
        DECLARE $chat_id AS Utf8;
        DECLARE $step AS Utf8;
        UPSERT INTO bot_state (chat_id, step) VALUES ($chat_id, $step);
      `, {
        chat_id: { t: 'utf8', v: String(chatId) },
        step: { t: 'utf8', v: step }
      });
    });
  }
}

module.exports = { YdbRepo, ydbEndpoint };
