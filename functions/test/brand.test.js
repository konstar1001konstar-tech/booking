'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { renderDocument } = require('../src/render');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const css = read('src/input.css');
const api = read('api/openapi.yaml');
const upload = read('scripts/upload-static.sh');

test('brand: логотип БьютиЛинк на главной, в настройках, во входе и в подвале мастера', () => {
  assert.match(html, /<title>БьютиЛинк — онлайн-запись к бьюти-мастеру<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="БьютиЛинк">/);
  assert.match(html, /<symbol id="bl-mark"/);
  const wordmarks = html.match(/<span class="wordmark[^"]*"><b>Бьюти<\/b><i>Линк<\/i><\/span>/g) || [];
  assert.ok(wordmarks.length >= 5, 'логотипов: ' + wordmarks.length);
  for (const id of ['lock-view', 'admin-view', 'panel-title']) {
    const at = html.indexOf('id="' + id + '"');
    assert.ok(at > 0, id);
  }
  assert.match(html, /<footer[\s\S]*?href="\/"[\s\S]*?Сделано на[\s\S]*?<b>Бьюти<\/b><i>Линк<\/i>[\s\S]*?<\/footer>/);
  assert.doesNotMatch(html, /визитк|Онлайн-запись<\/span>/i);
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.short_name, 'БьютиЛинк');
});

test('brand: шрифт свой (без Google Fonts), woff2, лёгкий, с лицензией OFL и маршрутом в шлюзе', () => {
  assert.doesNotMatch(html + css, /fonts\.(googleapis|gstatic)\.com/);
  const urls = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 2);
  let total = 0;
  for (const url of urls) {
    const file = path.join(root, url);
    const buf = fs.readFileSync(file);
    assert.equal(buf.toString('latin1', 0, 4), 'wOF2', url);
    total += buf.length;
    assert.ok(api.includes('  ' + url + ':') && api.includes('object: ' + url.slice(1)), 'нет маршрута ' + url);
    assert.ok(html.includes('<link rel="preload" href="' + url + '" as="font" type="font/woff2" crossorigin>'), 'нет preload ' + url);
  }
  assert.ok(total < 45 * 1024, 'шрифты весят ' + total);
  assert.match(upload, /fonts\/\*\.woff2/);
  assert.match(read('fonts/OFL.txt'), /SIL Open Font License, Version 1\.1/);
  assert.match(read('favicon.svg'), /^<svg[^>]+viewBox="0 0 48 48"/);
  const png = fs.readFileSync(path.join(root, 'apple-touch-icon.png'));
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
});

test('brand: заголовки страниц сервера несут имя продукта', () => {
  const out = renderDocument(html, { title: 'Анна — онлайн-запись · БьютиЛинк', description: 'd', theme: 'rose' });
  assert.match(out, /<title>Анна — онлайн-запись · БьютиЛинк<\/title>/);
  assert.match(out, /og:site_name" content="БьютиЛинк"/);
});
