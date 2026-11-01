'use strict';

const { HttpError } = require('./errors');
const { validateSlug } = require('./lib/profile');
const http = require('./http');
const { loadTemplate, renderDocument } = require('./render');
const service = require('./service');
const { isTimerEvent } = require('./outbox');
const { uploadPhoto } = require('./photos');
const { privacyHtml, termsHtml } = require('./legal-pages');

const SLUG_PATH = /^\/([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9]))$/;
const AUTH_PATH = /^\/api\/auth\/(yandex|vkid)\/(start|callback)$/;
const BOOKING_ACTION = /^\/api\/admin\/bookings\/([A-Za-z0-9_-]{8,32})\/(confirm|cancel|delete)$/;

function pageMeta(path, master, base) {
  if (path === '/admin') {
    return {
      title: 'Вход для мастера · БьютиЛинк',
      description: 'Вход в настройки страницы записи через Яндекс ID или Mail.ru.',
      url: base + '/admin',
      robots: 'noindex'
    };
  }
  if (master && master.published) {
    const name = master.profile.name;
    const description = master.profile.desc || 'Услуги, портфолио и заявка на удобное время.';
    return {
      title: name + ' — онлайн-запись · БьютиЛинк',
      description,
      url: base + '/' + master.slug,
      image: master.profile.photo || '',
      theme: master.profile.theme
    };
  }
  if (path !== '/' && path !== '/admin') {
    return {
      title: 'Страница не найдена · БьютиЛинк',
      description: 'Ссылка на онлайн-запись не открывается.',
      url: base + path
    };
  }
  return {
    title: 'БьютиЛинк — онлайн-запись к бьюти-мастеру',
    description: 'БьютиЛинк — красивая страница записи для бьюти-мастера: услуги, цены, портфолио и заявка на удобное время. Мастер видит заявки в панели и подтверждает запись в один клик.',
    url: base || ''
  };
}

function legalPage(path, base, deps) {
  const conf = service.publicConfig(deps);
  const ctx = { base, owner: conf.owner, bot: conf.bot, retentionMonths: conf.retentionMonths };
  const body = path === '/privacy' ? privacyHtml(ctx) : termsHtml(ctx);
  return http.html(200, body, { 'Cache-Control': 'public, max-age=300' });
}

async function renderPage(event, deps) {
  const path = http.requestPath(event);
  const base = http.publicBase(event, deps);
  if (path === '/privacy' || path === '/terms-masters') return legalPage(path, base, deps);
  let master = null;
  let status = 200;
  const match = SLUG_PATH.exec(path);
  if (match && path !== '/admin') {
    master = await deps.repo.getMasterBySlug(match[1]);
    if (!master || !master.published) status = 404;
  }
  const html = renderDocument(loadTemplate(), pageMeta(path, master, base));
  return http.html(status, html);
}

async function route(event, deps) {
  const method = http.requestMethod(event);
  const path = http.requestPath(event);
  const query = http.queryOf(event);
  const enriched = Object.assign({}, event, {
    ip: http.clientIp(event),
    base: http.publicBase(event, deps)
  });

  if (method === 'GET' && path === '/api/health') {
    const webhook = await service.maybeSetWebhook(deps, enriched.base);
    return http.json(200, { ok: true, webhook });
  }

  if (method === 'GET' && !path.startsWith('/api')) return renderPage(enriched, deps);

  if (method === 'GET' && path === '/api/config') {
    return http.json(200, service.publicConfig(deps), { 'Cache-Control': 'public, max-age=60' });
  }
  const auth = AUTH_PATH.exec(path);
  if (method === 'GET' && auth) {
    if (auth[2] === 'start') return service.oauthStart(deps, enriched, auth[1], query);
    return service.oauthCallback(deps, enriched, auth[1], query);
  }

  // Фото идут сырым (бинарным) телом, поэтому до разбора JSON.
  if (method === 'POST' && path === '/api/admin/photos') {
    const master = service.requireMaster(await service.sessionFrom(event, deps));
    return http.json(200, await uploadPhoto(deps, master, enriched, query, deps.limits));
  }

  let body = null;
  if (method !== 'GET' && method !== 'HEAD') body = http.readJson(event);

  if (method === 'GET') {
    const masterMatch = /^\/api\/masters\/([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9]))$/.exec(path);
    if (masterMatch) return http.json(200, await service.getPublicMaster(deps, masterMatch[1]));
    const slotsMatch = /^\/api\/masters\/([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9]))\/slots$/.exec(path);
    if (slotsMatch) return http.json(200, await service.getSlots(deps, slotsMatch[1], query));
    if (path === '/api/admin/me') {
      const master = service.requireMaster(await service.sessionFrom(event, deps));
      return http.json(200, service.adminMe(deps, master));
    }
    if (path === '/api/auth/signup') return http.json(200, service.signupInfo(deps, event));
    if (path === '/api/admin/profile') {
      const master = service.requireMaster(await service.sessionFrom(event, deps));
      return http.json(200, service.publicProfile(master));
    }
    if (path === '/api/admin/bookings') {
      const master = service.requireMaster(await service.sessionFrom(event, deps));
      const rows = await deps.repo.listBookings(master.slug);
      return http.json(200, { ok: true, bookings: rows.map(service.bookingView) });
    }
  }

  if (method === 'POST' && path === '/api/bookings') {
    return http.json(200, await service.createBooking(deps, enriched, body || {}));
  }
  if (method === 'POST' && path === '/api/admin/session') {
    const opened = await service.openSession(deps, body || {});
    return http.json(200, opened.body, { 'Set-Cookie': opened.cookie });
  }
  if (method === 'POST' && path === '/api/auth/signup') {
    const made = await service.signup(deps, event, body || {});
    return http.json(200, made.body, { 'Set-Cookie': made.cookies });
  }
  if (method === 'POST' && path === '/api/admin/telegram-link') {
    const master = service.requireMaster(await service.sessionFrom(event, deps));
    return http.json(200, await service.telegramLinkUrl(deps, master));
  }
  if (method === 'POST' && path === '/api/admin/telegram-widget') {
    const opened = await service.openWidgetSession(deps, body || {});
    return http.json(200, opened.body, { 'Set-Cookie': opened.cookie });
  }
  if (method === 'POST' && path === '/api/admin/logout') {
    const blank = require('./lib/session').cookie('bc_session', '', { secure: Boolean(deps.secureCookie), maxAge: 0 });
    return http.json(200, { ok: true }, { 'Set-Cookie': blank });
  }
  if (method === 'PUT' && path === '/api/admin/profile') {
    const master = service.requireMaster(await service.sessionFrom(event, deps));
    return http.json(200, await service.saveProfile(deps, master, body || {}, enriched.base));
  }
  if (method === 'POST' && path === '/api/telegram/webhook') {
    return http.json(200, await service.handleWebhook(deps, enriched, body || {}));
  }
  const action = BOOKING_ACTION.exec(path);
  if (method === 'POST' && action) {
    const master = service.requireMaster(await service.sessionFrom(event, deps));
    return http.json(200, await service.changeBooking(deps, master, action[1], action[2]));
  }
  if (path.startsWith('/api')) return http.json(404, { ok: false, error: 'not_found', message: 'Неизвестный запрос.' });
  return renderPage(enriched, deps);
}

function createHandler(deps) {
  return async function handler(event) {
    if (isTimerEvent(event)) {
      // Таймер раз в минуту: досылаем сообщения из outbox.
      try {
        const stats = await service.processOutbox(deps);
        let sweep = null;
        try {
          sweep = await service.purgeExpired(deps);
        } catch (e) {
          console.error('retention sweep failed');
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true, outbox: stats, sweep }) };
      } catch (err) {
        console.error('outbox run failed');
        return { statusCode: 500, body: JSON.stringify({ ok: false }) };
      }
    }
    try {
      return await route(event || {}, deps);
    } catch (err) {
      if (err && err.code === 'bad_json') {
        return http.json(400, { ok: false, error: 'validation', message: 'Не удалось прочитать запрос.' });
      }
      if (err && err.code === 'too_big' && !(err instanceof HttpError)) {
        return http.json(413, { ok: false, error: 'validation', message: 'Слишком большой запрос.' });
      }
      if (err instanceof HttpError) {
        return http.json(err.httpStatus, { ok: false, error: err.code, message: err.message });
      }
      console.error('handler', err && err.code ? err.code : 'internal');
      return http.json(500, { ok: false, error: 'internal', message: 'Не получилось обработать запрос.' });
    }
  };
}

module.exports = { createHandler, validateSlug };
