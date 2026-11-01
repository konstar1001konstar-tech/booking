'use strict';

// Вход мастера через российских провайдеров (ч.10 ст.8 149-ФЗ в ред. 199-ФЗ):
//   yandex — Яндекс ID (oauth.yandex.ru), код + PKCE + client_secret;
//   vkid   — VK ID (id.vk.ru) с сразу открытой формой входа Mail.ru
//            (provider=mail_ru), код + PKCE (OAuth 2.1).
// Поток серверный: /api/auth/<p>/start ставит подписанную куку bc_oauth со
// state и code_verifier и уводит на провайдера; /api/auth/<p>/callback
// сверяет state, меняет код на токен и узнаёт id пользователя.
// Провайдер без client_id не показывается и не открывается.

const crypto = require('crypto');
const { HttpError } = require('./errors');
const { sign, verify, randomId, readCookie, safeEqual } = require('./lib/session');
const { headerMap } = require('./http');

const FLOW_MS = 10 * 60 * 1000;
const SIGNUP_MS = 30 * 60 * 1000;
const FLOW_COOKIE = 'bc_oauth';
const SIGNUP_COOKIE = 'bc_signup';

const PROVIDERS = {
  yandex: {
    label: 'Яндекс ID',
    button: 'Войти с Яндекс ID',
    needsSecret: true,
    authorizeUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    userUrl: 'https://login.yandex.ru/info?format=json'
  },
  vkid: {
    label: 'Mail.ru (VK ID)',
    button: 'Войти через Mail.ru',
    needsSecret: false,
    authorizeUrl: 'https://id.vk.ru/authorize',
    tokenUrl: 'https://id.vk.ru/oauth2/auth',
    userUrl: 'https://id.vk.ru/oauth2/user_info'
  }
};

function oauthConf(deps) {
  return deps.oauth || {};
}

function providerConf(deps, id) {
  const meta = PROVIDERS[id];
  if (!meta) return null;
  const conf = oauthConf(deps)[id] || {};
  if (!conf.clientId) return null;
  if (meta.needsSecret && !conf.clientSecret) return null;
  return Object.assign({ id }, meta, conf);
}

function enabledProviders(deps) {
  return Object.keys(PROVIDERS)
    .map((id) => providerConf(deps, id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, label: p.label, button: p.button }));
}

function redirectUri(base, id) {
  return base + '/api/auth/' + id + '/callback';
}

function pkcePair() {
  // 64 символа из [A-Za-z0-9_-] — подходит и Яндексу, и VK ID (43–128).
  const verifier = randomId(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function flowCookie(deps, value, maxAgeSec) {
  const parts = [FLOW_COOKIE + '=' + value, 'HttpOnly', 'Path=/api/auth', 'SameSite=Lax', 'Max-Age=' + maxAgeSec];
  if (deps.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

function signupCookie(deps, value, maxAgeSec) {
  const parts = [SIGNUP_COOKIE + '=' + value, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=' + maxAgeSec];
  if (deps.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

function nowMs(deps) {
  return (deps.now ? deps.now() : new Date()).getTime();
}

function secretOf(deps) {
  const secret = deps.secrets && deps.secrets.sessionSecret;
  if (!secret) throw new HttpError(503, 'not_configured', 'Вход мастера ещё не настроен.');
  return secret;
}

// mode: 'login' — вход/регистрация; 'link' — привязка к уже открытой сессии.
function startFlow(deps, id, base, mode, linkSlug) {
  const p = providerConf(deps, id);
  if (!p) throw new HttpError(404, 'not_found', 'Этот способ входа не подключён.');
  const secret = secretOf(deps);
  const state = randomId(32);
  const pkce = pkcePair();
  const flow = sign({
    typ: 'oauth', p: id, st: state, cv: pkce.verifier, m: mode === 'link' ? 'link' : 'login',
    ls: mode === 'link' ? String(linkSlug || '') : '', exp: nowMs(deps) + FLOW_MS
  }, secret);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: redirectUri(base, id),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256'
  });
  if (id === 'vkid') {
    q.set('provider', 'mail_ru');
    q.set('scope', 'vkid.personal_info');
  }
  return {
    location: p.authorizeUrl + '?' + q.toString(),
    cookie: flowCookie(deps, flow, Math.floor(FLOW_MS / 1000))
  };
}

function readFlow(deps, event, id, state) {
  const token = readCookie(headerMap(event).cookie, FLOW_COOKIE);
  const flow = verify(token, secretOf(deps), nowMs(deps));
  if (!flow || flow.typ !== 'oauth' || flow.p !== id) return null;
  if (!state || !safeEqual(String(state), String(flow.st))) return null;
  return flow;
}

async function postForm(deps, url, form, headers) {
  const doFetch = deps.fetch || ((...a) => fetch(...a));
  const init = {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, headers || {}),
    body: new URLSearchParams(form).toString()
  };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
  const res = await doFetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error('oauth ' + res.status);
    err.code = 'oauth_exchange';
    throw err;
  }
  return data;
}

async function getJson(deps, url, headers) {
  const doFetch = deps.fetch || ((...a) => fetch(...a));
  const init = { method: 'GET', headers: Object.assign({ Accept: 'application/json' }, headers || {}) };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
  const res = await doFetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('oauth user ' + res.status);
    err.code = 'oauth_user';
    throw err;
  }
  return data;
}

// Возвращает { sub, name } — только то, что нужно для входа. Токены провайдера
// нигде не сохраняются.
async function exchange(deps, id, base, flow, query) {
  const p = providerConf(deps, id);
  if (!p) throw new HttpError(404, 'not_found', 'Этот способ входа не подключён.');
  const code = String(query.code || '');
  if (!code) throw new HttpError(400, 'validation', 'Провайдер не вернул код.');
  if (id === 'yandex') {
    const tok = await postForm(deps, p.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: flow.cv
    });
    const info = await getJson(deps, p.userUrl, { Authorization: 'OAuth ' + tok.access_token });
    if (!info || !info.id) throw new HttpError(502, 'oauth_user', 'Яндекс не вернул профиль.');
    return { sub: String(info.id), name: String(info.first_name || info.display_name || info.real_name || '').slice(0, 60) };
  }
  const deviceId = String(query.device_id || '');
  const form = {
    grant_type: 'authorization_code',
    code_verifier: flow.cv,
    redirect_uri: redirectUri(base, id),
    code,
    client_id: p.clientId,
    device_id: deviceId,
    state: flow.st
  };
  if (p.clientSecret) form.client_secret = p.clientSecret;
  const tok = await postForm(deps, p.tokenUrl, form);
  let name = '';
  let sub = tok.user_id != null ? String(tok.user_id) : '';
  try {
    const info = await postForm(deps, p.userUrl, { client_id: p.clientId, access_token: tok.access_token });
    const user = info && info.user ? info.user : {};
    if (user.user_id != null) sub = String(user.user_id);
    name = String(user.first_name || '').slice(0, 60);
  } catch (e) {
    if (!sub) throw e;
  }
  if (!sub) throw new HttpError(502, 'oauth_user', 'VK ID не вернул профиль.');
  return { sub, name };
}

function signupToken(deps, ident) {
  return sign({ typ: 'signup', p: ident.p, sub: ident.sub, name: ident.name || '', exp: nowMs(deps) + SIGNUP_MS }, secretOf(deps));
}

function readSignup(deps, event) {
  const token = readCookie(headerMap(event).cookie, SIGNUP_COOKIE);
  const data = verify(token, secretOf(deps), nowMs(deps));
  if (!data || data.typ !== 'signup' || !PROVIDERS[data.p] || !data.sub) return null;
  return data;
}

module.exports = {
  PROVIDERS,
  FLOW_MS,
  SIGNUP_MS,
  enabledProviders,
  providerConf,
  redirectUri,
  startFlow,
  readFlow,
  exchange,
  flowCookie,
  signupCookie,
  signupToken,
  readSignup
};
