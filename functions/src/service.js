'use strict';

const { HttpError, RepoError } = require('./errors');
const { validateSlug, sanitizeProfile, starterProfile, normalizeClientPhone } = require('./lib/profile');
const { assertSlotOpen, dateText } = require('./lib/slots');
const { DEFAULT_LIMITS, tooMany } = require('./lib/rate');
const { bookingMessage, bookingKeyboard } = require('./lib/html');
const { sign, verify, randomId, cookie, readCookie, safeEqual, SESSION_MS, LOGIN_MS } = require('./lib/session');
const { checkTelegramLogin } = require('./lib/telegram-auth');
const { headerMap } = require('./http');
const outbox = require('./outbox');
const photos = require('./photos');

function secretsOf(deps) {
  return deps.secrets || { botToken: '', sessionSecret: '', webhookSecret: '' };
}

function nowOf(deps) {
  return deps.now ? deps.now() : new Date();
}

function limitsOf(deps) {
  return deps.limits || DEFAULT_LIMITS;
}

function requireSessionSecret(deps) {
  const secret = secretsOf(deps).sessionSecret;
  if (!secret) throw new HttpError(503, 'not_configured', 'Вход мастера ещё не настроен.');
  return secret;
}

async function sessionFrom(event, deps) {
  const secret = secretsOf(deps).sessionSecret;
  if (!secret) return null;
  const token = readCookie(headerMap(event).cookie, 'bc_session');
  const payload = verify(token, secret, nowOf(deps).getTime());
  if (!payload || payload.typ !== 'sess' || !payload.slug) return null;
  const master = await deps.repo.getMasterBySlug(payload.slug);
  if (!master || String(master.chatId) !== String(payload.chatId)) return null;
  return master;
}

function requireMaster(master) {
  if (!master) throw new HttpError(401, 'unauthorized', 'Войдите по ссылке из Telegram.');
  return master;
}

function publicProfile(master) {
  return {
    ok: true,
    slug: master.slug,
    published: Boolean(master.published),
    profile: master.profile
  };
}

function bookingView(row) {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    dateText: row.dateText,
    name: row.clientName,
    phone: row.clientPhone,
    serviceName: row.serviceName,
    servicePrice: row.servicePrice,
    serviceDur: row.serviceDur,
    status: row.status,
    createdAt: row.createdAt
  };
}

async function issueLoginToken(deps, master) {
  const secret = requireSessionSecret(deps);
  const now = nowOf(deps).getTime();
  const jti = randomId(16);
  const exp = now + LOGIN_MS;
  await deps.repo.putLogin(jti, { slug: master.slug, chatId: String(master.chatId), exp });
  return sign({ typ: 'login', slug: master.slug, chatId: String(master.chatId), exp, jti }, secret);
}

function sessionCookie(deps, master) {
  const secret = requireSessionSecret(deps);
  const exp = nowOf(deps).getTime() + SESSION_MS;
  const token = sign({
    typ: 'sess',
    slug: master.slug,
    chatId: String(master.chatId),
    exp
  }, secret);
  return cookie('bc_session', token, {
    secure: Boolean(deps.secureCookie),
    maxAge: Math.floor(SESSION_MS / 1000)
  });
}

async function getPublicMaster(deps, slug) {
  const master = await deps.repo.getMasterBySlug(slug);
  if (!master) throw new HttpError(404, 'not_found', 'Страница не найдена.');
  if (!master.published) throw new HttpError(404, 'not_published', 'Мастер ещё не открыл запись.');
  return publicProfile(master);
}

async function getSlots(deps, slug, query) {
  const master = await deps.repo.getMasterBySlug(slug);
  if (!master || !master.published) throw new HttpError(404, 'not_found', 'Страница не найдена.');
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new HttpError(400, 'validation', 'Укажите даты from и to в формате ГГГГ-ММ-ДД.');
  }
  const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  if (span > 62) throw new HttpError(400, 'validation', 'Слишком длинный интервал.');
  const busy = await deps.repo.listBusy(slug, from, to);
  return {
    ok: true,
    tz: master.profile.tz,
    slots: master.profile.slots,
    workDays: master.profile.workDays,
    busy
  };
}

async function createBooking(deps, event, body) {
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 60) {
    throw new HttpError(400, 'validation', 'Введите имя, минимум 2 символа.');
  }
  const phone = normalizeClientPhone(body.phone);
  if (!phone) throw new HttpError(400, 'validation', 'Введите телефон полностью, вместе с кодом страны.');
  if (body.consent !== true) throw new HttpError(400, 'validation', 'Нужно согласие на обработку данных.');
  const slugCheck = validateSlug(body.slug);
  if (!slugCheck.ok) throw new HttpError(404, 'not_found', 'Страница не найдена.');
  const master = await deps.repo.getMasterBySlug(slugCheck.slug);
  if (!master || !master.published) throw new HttpError(404, 'not_found', 'Страница не найдена.');
  const service = (master.profile.services || []).find((item) => item.name === String(body.serviceName || '').trim());
  if (!service) throw new HttpError(400, 'validation', 'Такой услуги нет в прайсе.');
  const date = String(body.date || '');
  const time = String(body.time || '');
  const now = nowOf(deps);
  assertSlotOpen(master.profile, date, time, now);
  const limits = limitsOf(deps);
  const ip = event.ip || 'unknown';
  if (await tooMany(deps.repo, 'ip:' + ip + ':' + master.slug, limits.ip, now.getTime())) {
    throw new HttpError(429, 'rate_limited', 'Слишком много заявок с этого адреса. Попробуйте позже.');
  }
  if (await tooMany(deps.repo, 'phone:' + phone + ':' + master.slug, limits.phone, now.getTime())) {
    throw new HttpError(429, 'rate_limited', 'Слишком много заявок с этого телефона. Попробуйте позже.');
  }
  const booking = {
    id: randomId(9),
    slug: master.slug,
    slotKey: date + 'T' + time,
    date,
    time,
    dateText: dateText(date, master.profile.tz),
    clientName: name.replace(/[\r\n]+/g, ' '),
    clientPhone: phone,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDur: service.dur || '',
    status: 'pending',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    tgMessageId: ''
  };
  try {
    await deps.repo.createBooking(booking);
  } catch (err) {
    if (err instanceof RepoError && err.code === 'slot_taken') {
      throw new HttpError(409, 'slot_taken', 'Это время уже занято. Выберите другое.');
    }
    throw err;
  }
  // Одна быстрая попытка; если релей не ответил — заявка уходит в outbox,
  // и таймер дошлёт её мастеру. Клиент ответа Telegram не ждёт.
  const delivery = await outbox.sendOrQueue(deps, master.chatId, bookingMessage(booking, master), {
    parseMode: 'HTML',
    replyMarkup: bookingKeyboard(booking.id)
  }, { bookingId: booking.id });
  if (delivery.sent && delivery.messageId) {
    try { await deps.repo.setMessageId(booking.id, delivery.messageId); } catch (e) { /* не критично */ }
  }
  const notified = delivery.sent;
  return { ok: true, bookingId: booking.id, notified, queued: Boolean(delivery.queued) };
}

async function openSession(deps, body) {
  const secret = requireSessionSecret(deps);
  const payload = verify(body && body.token, secret, nowOf(deps).getTime());
  if (!payload || payload.typ !== 'login' || !payload.jti) {
    throw new HttpError(401, 'unauthorized', 'Ссылка для входа недействительна.');
  }
  const row = await deps.repo.consumeLogin(payload.jti, nowOf(deps).getTime());
  if (!row || row.slug !== payload.slug || String(row.chatId) !== String(payload.chatId)) {
    throw new HttpError(401, 'unauthorized', 'Ссылка для входа уже использована или истекла. Запросите новую у бота.');
  }
  const master = await deps.repo.getMasterBySlug(row.slug);
  if (!master || String(master.chatId) !== String(row.chatId)) {
    throw new HttpError(401, 'unauthorized', 'Мастер не найден.');
  }
  return {
    body: { ok: true, slug: master.slug },
    cookie: sessionCookie(deps, master)
  };
}

async function openWidgetSession(deps, body) {
  const user = checkTelegramLogin(body, secretsOf(deps).botToken, nowOf(deps).getTime());
  if (!user) throw new HttpError(401, 'unauthorized', 'Не удалось проверить вход Telegram.');
  const master = await deps.repo.getMasterByChat(user.id);
  if (!master) {
    throw new HttpError(404, 'not_found', 'Сначала напишите боту /start и выберите адрес страницы.');
  }
  return {
    body: { ok: true, slug: master.slug },
    cookie: sessionCookie(deps, master)
  };
}

async function saveProfile(deps, master, body, base) {
  const cleaned = sanitizeProfile(body || {});
  if (!cleaned.ok) throw new HttpError(400, 'validation', cleaned.message);
  const updated = await deps.repo.updateMasterProfile(
    master.slug,
    cleaned.profile,
    true,
    nowOf(deps).toISOString()
  );
  await photos.cleanupPhotos(deps, master.slug, base || '', master.profile, updated.profile || cleaned.profile);
  return { ok: true, slug: master.slug, published: true, profile: updated.profile || cleaned.profile };
}

async function changeBooking(deps, master, id, action) {
  const booking = await deps.repo.getBooking(id);
  if (!booking || booking.slug !== master.slug) throw new HttpError(404, 'not_found', 'Заявка не найдена.');
  if (action === 'delete') {
    await deps.repo.deleteBooking(id);
    return { ok: true };
  }
  const status = action === 'confirm' ? 'confirmed' : 'cancelled';
  try {
    await deps.repo.setBookingStatus(id, status, nowOf(deps).toISOString());
  } catch (err) {
    if (err instanceof RepoError && err.code === 'closed') {
      throw new HttpError(409, 'closed', 'Отменённую заявку нельзя подтвердить.');
    }
    throw err;
  }
  return { ok: true, status };
}

function linksText(base, master, token) {
  const page = base + '/' + master.slug;
  const login = base + '/admin?token=' + token;
  const lines = [
    'БьютиЛинк — ваша страница записи.',
    '',
    'Страница для клиентов:',
    page,
    '',
    'Ссылка для входа в настройки (10 минут, один раз):',
    login
  ];
  if (master.published) lines.push('', 'Страница уже открыта для записи.');
  else lines.push('', 'Страница ещё не открыта клиентам. Войдите по ссылке, заполните услуги и сохраните профиль.');
  return lines.join('\n');
}

function reply(deps, chatId, text) {
  return outbox.sendOrQueue(deps, chatId, text, {}, { ttlMs: 15 * 60 * 1000 });
}

async function sendLinks(deps, event, master) {
  const base = event.base || '';
  if (!base) return;
  const token = await issueLoginToken(deps, master);
  // Ссылка для входа живёт 10 минут — досылать её позже нет смысла.
  await outbox.sendOrQueue(deps, master.chatId, linksText(base, master, token), {}, { ttlMs: 9 * 60 * 1000 });
}

async function onTelegramMessage(deps, event, message) {
  const chatId = String(message.chat && message.chat.id || '');
  if (!chatId) return;
  const text = String(message.text || '').trim();
  const fromId = String(message.from && message.from.id || chatId);
  const master = await deps.repo.getMasterByChat(chatId);
  if (text.startsWith('/start') || text.startsWith('/link') || text.startsWith('/help')) {
    if (master) {
      await deps.repo.setBotState(chatId, '');
      await sendLinks(deps, event, master);
      return;
    }
    await deps.repo.setBotState(chatId, 'await_slug');
    await reply(deps, chatId, 'Добро пожаловать в БьютиЛинк! Пришлите короткий адрес страницы латиницей, 3–32 символа, например anna-nails. Клиенты откроют запись по ссылке с этим адресом. Адрес потом нельзя сменить.');
    return;
  }
  const step = await deps.repo.getBotState(chatId);
  if (step === 'await_slug') {
    const check = validateSlug(text.toLowerCase());
    if (!check.ok) {
      await reply(deps, chatId, check.message);
      return;
    }
    const stamp = nowOf(deps).toISOString();
    try {
      await deps.repo.insertMaster({
        slug: check.slug,
        chatId,
        telegramUserId: fromId,
        published: false,
        profile: starterProfile(message.from && message.from.first_name),
        createdAt: stamp,
        updatedAt: stamp
      });
    } catch (err) {
      if (err instanceof RepoError && err.code === 'slug_taken') {
        await reply(deps, chatId, 'Этот адрес уже занят. Пришлите другой.');
        return;
      }
      if (err instanceof RepoError && err.code === 'chat_taken') {
        const existing = await deps.repo.getMasterByChat(chatId);
        if (existing) await sendLinks(deps, event, existing);
        return;
      }
      throw err;
    }
    await deps.repo.setBotState(chatId, '');
    const created = await deps.repo.getMasterBySlug(check.slug);
    await sendLinks(deps, event, created);
    return;
  }
  await reply(deps, chatId, 'Это бот БьютиЛинк. Напишите /start, чтобы получить ссылку на страницу и вход в настройки.');
}

async function onCallback(deps, query) {
  const id = query.id;
  const data = String(query.data || '');
  const match = /^(ok|no):([A-Za-z0-9_-]{8,32})$/.exec(data);
  if (!match) {
    await deps.telegram.answerCallbackQuery(id, 'Неизвестная кнопка');
    return;
  }
  const booking = await deps.repo.getBooking(match[2]);
  if (!booking) {
    await deps.telegram.answerCallbackQuery(id, 'Заявка не найдена');
    return;
  }
  const master = await deps.repo.getMasterBySlug(booking.slug);
  const chatId = String(query.message && query.message.chat && query.message.chat.id || '');
  if (!master || chatId !== String(master.chatId)) {
    await deps.telegram.answerCallbackQuery(id, 'Это не ваша заявка');
    return;
  }
  if (match[1] === 'ok') {
    if (booking.status === 'cancelled') {
      await deps.telegram.answerCallbackQuery(id, 'Заявка уже отменена');
      return;
    }
    await deps.repo.setBookingStatus(booking.id, 'confirmed', nowOf(deps).toISOString());
    await deps.telegram.answerCallbackQuery(id, 'Запись подтверждена');
  } else {
    if (booking.status === 'cancelled') {
      await deps.telegram.answerCallbackQuery(id, 'Уже отменена');
      return;
    }
    await deps.repo.setBookingStatus(booking.id, 'cancelled', nowOf(deps).toISOString());
    await deps.telegram.answerCallbackQuery(id, 'Запись отменена, время снова свободно');
  }
  const messageId = query.message && query.message.message_id;
  if (messageId) {
    try { await deps.telegram.editMessageReplyMarkup(chatId, messageId); } catch (e) { /* кнопки уже сняты */ }
  }
}

async function handleWebhook(deps, event, body) {
  const secret = secretsOf(deps).webhookSecret;
  const headers = headerMap(event);
  const got = headers['x-telegram-bot-api-secret-token'] || '';
  if (!secret || !safeEqual(got, secret)) {
    throw new HttpError(401, 'unauthorized', 'Неверный секрет вебхука.');
  }
  if (body.message) await onTelegramMessage(deps, event, body.message);
  else if (body.callback_query) await onCallback(deps, body.callback_query);
  return { ok: true };
}

let webhookAttempted = false;

// Куда Telegram шлёт обновления. WEBHOOK_URL — пересылка на Vercel
// (api/tg-hook.js): серверы Telegram не всегда достают до Yandex Cloud.
// Пусто — прямо на адрес сайта.
function webhookTarget(deps, base) {
  return deps.webhookUrl || (base + '/api/telegram/webhook');
}

async function maybeSetWebhook(deps, base) {
  if (!deps.setWebhook || webhookAttempted) return 'skipped';
  const conf = secretsOf(deps);
  if (!conf.botToken || !conf.webhookSecret || !base) return 'skipped';
  webhookAttempted = true;
  try {
    await deps.telegram.setWebhook(webhookTarget(deps, base), conf.webhookSecret);
    return 'set';
  } catch (e) {
    return 'error';
  }
}

module.exports = {
  processOutbox: outbox.processOutbox,
  getPublicMaster,
  getSlots,
  createBooking,
  openSession,
  openWidgetSession,
  saveProfile,
  changeBooking,
  handleWebhook,
  sessionFrom,
  requireMaster,
  publicProfile,
  bookingView,
  issueLoginToken,
  sessionCookie,
  maybeSetWebhook,
  webhookTarget
};
