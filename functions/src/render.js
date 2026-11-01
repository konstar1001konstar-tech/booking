'use strict';

const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('./lib/html');
const { THEME_PRIMARY, themeOf } = require('./lib/themes');

let cached = '';

function loadTemplate() {
  if (cached) return cached;
  const candidates = [
    process.env.INDEX_HTML_PATH,
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', '..', 'index.html')
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      cached = fs.readFileSync(file, 'utf8');
      return cached;
    }
  }
  cached = '<!doctype html><html lang="ru"><head><title>Онлайн-запись к мастеру</title></head><body><p>Шаблон страницы не найден.</p></body></html>';
  return cached;
}

function replaceAttr(html, regex, value) {
  return html.replace(regex, (full, open, close) => open + value + close);
}

function renderDocument(template, meta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>');
  html = replaceAttr(html, /(<meta\s+name="description"\s+content=")[^"]*(")/, description);
  html = replaceAttr(html, /(<meta\s+property="og:title"\s+content=")[^"]*(")/, title);
  html = replaceAttr(html, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, description);
  html = replaceAttr(html, /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, title);
  html = replaceAttr(html, /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, description);
  html = replaceAttr(html, /(<meta\s+property="og:url"\s+content=")[^"]*(")/, escapeHtml(meta.url || ''));
  if (meta.image) {
    const image = escapeHtml(meta.image);
    if (html.includes('property="og:image"')) {
      html = replaceAttr(html, /(<meta\s+property="og:image"\s+content=")[^"]*(")/, image);
    } else {
      html = html.replace('</head>', '<meta property="og:image" content="' + image + '">\n</head>');
    }
  }
  if (meta.theme) {
    const theme = themeOf(meta.theme);
    html = html.replace(/(<html\b[^>]*\bclass=")theme-[a-z]+(")/, (full, open, close) => open + 'theme-' + theme + close);
    html = replaceAttr(html, /(<meta\s+name="theme-color"\s+content=")[^"]*(")/, THEME_PRIMARY[theme]);
  }
  if (meta.robots) {
    html = html.replace('</head>', '<meta name="robots" content="' + escapeHtml(meta.robots) + '">\n</head>');
  }
  return html;
}

module.exports = { loadTemplate, renderDocument };
