'use strict';

function headerMap(event) {
  const out = {};
  const src = event && event.headers ? event.headers : {};
  for (const key of Object.keys(src)) out[key.toLowerCase()] = src[key];
  if (event && Array.isArray(event.cookies) && event.cookies.length && !out.cookie) {
    out.cookie = event.cookies.join('; ');
  }
  return out;
}

function requestMethod(event) {
  const http = event && event.requestContext && event.requestContext.http;
  return String((event && event.httpMethod) || (http && http.method) || 'GET').toUpperCase();
}

function requestPath(event) {
  // Yandex API Gateway puts the route template (e.g. "/api/{proxy+}") into
  // event.path and the real request path into event.url.
  const templated = event && typeof event.path === 'string' && event.path.includes('{');
  const raw = (event && (event.rawPath || (templated && event.url) || event.path || event.url))
    || (event && event.requestContext && event.requestContext.http && event.requestContext.http.path)
    || '/';
  const path = String(raw).split('?')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

function queryOf(event) {
  if (event && event.queryStringParameters) return event.queryStringParameters;
  const raw = event && event.rawQueryString;
  if (!raw) return {};
  const out = {};
  for (const part of String(raw).split('&')) {
    if (!part) continue;
    const idx = part.indexOf('=');
    const key = decodeURIComponent(idx === -1 ? part : part.slice(0, idx));
    const value = decodeURIComponent(idx === -1 ? '' : part.slice(idx + 1));
    out[key] = value;
  }
  return out;
}

function clientIp(event) {
  const rc = (event && event.requestContext) || {};
  if (rc.identity && rc.identity.sourceIp) return String(rc.identity.sourceIp);
  if (rc.http && rc.http.sourceIp) return String(rc.http.sourceIp);
  const headers = headerMap(event);
  const forwarded = headers['x-forwarded-for'] || '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

function readJson(event) {
  if (!event || event.body == null || event.body === '') return {};
  let raw = event.body;
  if (typeof raw === 'object') return raw;
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(String(raw)) > 65536) {
    const err = new Error('too big');
    err.code = 'too_big';
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('json');
    err.code = 'bad_json';
    throw err;
  }
}

function json(status, body, extra) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extra || {});
  const cookies = [].concat(headers['Set-Cookie'] || []).filter(Boolean);
  if (cookies.length) headers['Set-Cookie'] = cookies[0];
  else delete headers['Set-Cookie'];
  const response = { statusCode: status, headers, body: JSON.stringify(body) };
  if (cookies.length) response.multiValueHeaders = { 'Set-Cookie': cookies };
  return response;
}

function html(status, body, extra) {
  return {
    statusCode: status,
    headers: Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    }, extra || {}),
    body
  };
}

function publicBase(event, deps) {
  if (deps.publicUrl) return String(deps.publicUrl).replace(/\/$/, '');
  const headers = headerMap(event);
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host) return '';
  const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return proto + '://' + host;
}

module.exports = {
  headerMap,
  requestMethod,
  requestPath,
  queryOf,
  clientIp,
  readJson,
  json,
  html,
  publicBase
};
