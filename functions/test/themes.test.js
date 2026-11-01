'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { THEMES, THEME_PRIMARY } = require('../src/lib/themes');
const { renderDocument } = require('../src/render');
const { sanitizeProfile, starterProfile } = require('../src/lib/profile');

const root = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'src', 'input.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const VARS = ['tg', 'tg-dark', 'on-tg', 'ios', 'milk', 'surface', 'ink', 'muted', 'line', 'hero'];

function palette(id) {
  const m = css.match(new RegExp('\\.theme-' + id + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, 'нет палитры .theme-' + id);
  const out = {};
  for (const [, name, r, g, b] of m[1].matchAll(/--c-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) out[name] = [r, g, b].map(Number);
  return out;
}

function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

test('themes: у каждой темы полная палитра и читаемый контраст (WCAG AA)', () => {
  for (const id of THEMES) {
    const p = palette(id);
    for (const v of VARS) assert.ok(p[v], id + ': нет --c-' + v);
    const pairs = [
      ['on-tg', 'tg'], ['on-tg', 'tg-dark'],
      ['tg', 'surface'], ['tg', 'ios'], ['tg', 'milk'],
      ['ink', 'milk'], ['ink', 'surface'], ['ink', 'ios'], ['ink', 'hero'],
      ['muted', 'milk'], ['muted', 'surface'], ['muted', 'ios'], ['muted', 'hero']
    ];
    for (const [fg, bg] of pairs) {
      const ratio = contrast(p[fg], p[bg]);
      assert.ok(ratio >= 4.5, `${id}: ${fg} на ${bg} = ${ratio.toFixed(2)} < 4.5`);
    }
    assert.equal(hex(p.tg), THEME_PRIMARY[id], id + ': theme-color не совпадает с --c-tg');
  }
});

test('themes: списки тем в сервере, app.js и панели совпадают; старые id остаются', () => {
  for (const id of ['plum', 'rose', 'wine', 'olive', 'sand', 'ink']) assert.ok(THEMES.includes(id), id);
  const m = app.match(/const THEMES = \[([^\]]*)\]/);
  assert.deepEqual(m[1].match(/[a-z]+/g), THEMES);
  const swatches = [...html.matchAll(/data-theme="([a-z]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(swatches, THEMES.slice().sort());
  // Утилиты интерфейса берут цвета из темы, а не из жёстких значений.
  assert.doesNotMatch(html, /text-\[#|bg-white(?![/\w-])|text-neutral-|#34c759/);
  assert.doesNotMatch(app, /text-neutral-|bg-white(?![/\w-])/);
});

test('themes: сервер отдаёт страницу сразу в цвете мастера', () => {
  const tpl = '<html lang="ru" class="theme-plum"><head><meta name="theme-color" content="#5B3A5E"><title>x</title></head></html>';
  const out = renderDocument(tpl, { title: 't', description: 'd', theme: 'ocean' });
  assert.match(out, /class="theme-ocean"/);
  assert.match(out, /name="theme-color" content="#2c5e88"/);
  const bad = renderDocument(tpl, { title: 't', description: 'd', theme: '"><script>' });
  assert.match(bad, /class="theme-plum"/);
  assert.doesNotMatch(bad, /<script>/);
  const real = renderDocument(html, { title: 't', description: 'd', theme: 'mint' });
  assert.match(real, /<html lang="ru" class="theme-mint">/);
  assert.match(real, /name="theme-color" content="#2d7464"/);
});

test('themes: профиль принимает новые темы и сбрасывает неизвестные', () => {
  const base = Object.assign(starterProfile('Анна'), { services: [{ name: 'Маникюр', price: 1500, dur: '' }] });
  assert.equal(sanitizeProfile(Object.assign({}, base, { theme: 'ocean' })).profile.theme, 'ocean');
  assert.equal(sanitizeProfile(Object.assign({}, base, { theme: 'neon' })).profile.theme, 'plum');
});
