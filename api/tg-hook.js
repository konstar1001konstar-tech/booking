'use strict';

// Пересылка вебхука Telegram в Yandex Cloud.
// Серверы Telegram не всегда могут достучаться до API Gateway Yandex Cloud
// (Connection timed out), а с Vercel он доступен. Поэтому вебхук бота смотрит
// сюда: POST /api/tg-hook -> <YANDEX_WEBHOOK_URL>.
// Заголовок X-Telegram-Bot-Api-Secret-Token передаётся как есть и проверяется
// функцией в Yandex Cloud; здесь только отсекаются запросы без него.
// Статус Yandex возвращается Telegram: на не-2xx Telegram повторит доставку.
// Ничего не логирует.

const TARGET = process.env.YANDEX_WEBHOOK_URL ||
  'https://d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net/api/telegram/webhook';
const MAX_BODY = 1024 * 1024;
const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function bodyOf(req) {
  let body;
  try {
    body = req.body;
  } catch (e) {
    body = undefined;
  }
  if (body === undefined || body === null) {
    const raw = await readRaw(req);
    return raw.length ? raw.toString('utf8') : '';
  }
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

module.exports = async function tgHook(req, res) {
  if (req.method === 'GET') return send(res, 200, { ok: true, forwarder: 'tg-hook' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return send(res, 405, { ok: false, description: 'method not allowed' });
  }
  const secret = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  if (!SECRET_RE.test(secret)) return send(res, 401, { ok: false, description: 'unauthorized' });

  let payload;
  try {
    payload = await bodyOf(req);
  } catch (e) {
    return send(res, 413, { ok: false, description: 'too big' });
  }
  if (payload.length > MAX_BODY) return send(res, 413, { ok: false, description: 'too big' });

  try {
    const upstream = await fetch(TARGET, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': secret
      },
      body: payload || '{}',
      signal: AbortSignal.timeout(25000)
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(text);
  } catch (e) {
    return send(res, 502, { ok: false, description: 'upstream error' });
  }
};
