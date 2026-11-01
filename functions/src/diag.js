'use strict';

// Диагностика сети до релея. Вызывается только прямым вызовом функции
// (yc serverless function invoke) с событием {"diag":"relay"}; через API Gateway
// такое событие не приходит. Возвращает только тайминги, без секретов.

const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const { pinnedFetch, parseIps } = require('./telegram');

function probeTls(ip, host, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = { ip, tcpMs: null, tlsMs: null, httpMs: null, status: null, error: null };
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      if (err) out.error = String(err.code || err.message || err);
      out.totalMs = Date.now() - t0;
      try { sock.destroy(); } catch (e) { /* ignore */ }
      resolve(out);
    };
    const raw = net.connect({ host: ip, port: 443 });
    const timer = setTimeout(() => finish(new Error('timeout_' + (out.tcpMs == null ? 'tcp' : out.tlsMs == null ? 'tls' : 'http'))), timeoutMs);
    let sock = raw;
    raw.on('error', (e) => { clearTimeout(timer); finish(e); });
    raw.on('connect', () => {
      out.tcpMs = Date.now() - t0;
      sock = tls.connect({ socket: raw, servername: host, ALPNProtocols: ['http/1.1'] });
      sock.on('error', (e) => { clearTimeout(timer); finish(e); });
      sock.on('secureConnect', () => {
        out.tlsMs = Date.now() - t0;
        sock.write('GET /api/tg/getMe HTTP/1.1\r\nHost: ' + host + '\r\nConnection: close\r\n\r\n');
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        const m = /^HTTP\/1\.1 (\d{3})/.exec(buf);
        if (m && out.httpMs == null) {
          out.httpMs = Date.now() - t0;
          out.status = Number(m[1]);
          clearTimeout(timer);
          finish(null);
        }
      });
    });
  });
}

async function timedFetch(url, timeoutMs) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    await res.text();
    return { url, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { url, error: String((e.cause && e.cause.code) || e.name || e), ms: Date.now() - t0 };
  }
}

async function relayDiag(relayUrl, extra) {
  const x = extra || {};
  const host = new URL(relayUrl).hostname;
  const out = { host };
  try { out.a = await dns.resolve4(host); } catch (e) { out.a = String(e.code); }
  try { out.aaaa = await dns.resolve6(host); } catch (e) { out.aaaa = String(e.code); }
  try { out.lookup = await dns.lookup(host, { all: true }); } catch (e) { out.lookup = String(e.code); }
  out.autoSelectFamily = net.getDefaultAutoSelectFamily ? net.getDefaultAutoSelectFamily() : null;
  const ips = (Array.isArray(out.a) ? out.a : []).concat(x.ips || []);
  const probes = [];
  for (const ip of ips) for (let i = 0; i < 3; i += 1) probes.push(probeTls(ip, host, 6000));
  // Контроль: другой хост Vercel и чужой SNI на тех же IP.
  for (const ip of ips) for (const sni of (x.snis || [])) probes.push(probeTls(ip, sni, 6000).then((r) => Object.assign(r, { sni })));
  const fetches = [];
  for (let i = 0; i < 4; i += 1) fetches.push(timedFetch(relayUrl.replace(/\/$/, '') + '/getMe', 6000));
  fetches.push(timedFetch('https://storage.yandexcloud.net/', 6000));
  const pinned = parseIps(process.env.RELAY_IPS);
  if (pinned.length) {
    const doPinned = pinnedFetch(pinned);
    for (let i = 0; i < 4; i += 1) {
      fetches.push((async () => {
        const t0 = Date.now();
        try {
          const res = await doPinned(relayUrl.replace(/\/$/, '') + '/getMe', { method: 'GET', signal: AbortSignal.timeout(6000) });
          return { pinned: true, status: res.status, ms: Date.now() - t0 };
        } catch (e) {
          return { pinned: true, error: String(e.code || e.name || e), ms: Date.now() - t0 };
        }
      })());
    }
  }
  const [p, f] = await Promise.all([Promise.all(probes), Promise.all(fetches)]);
  out.probes = p;
  out.fetches = f;
  return out;
}

module.exports = { relayDiag };
