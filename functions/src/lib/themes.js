'use strict';

// Темы оформления страницы мастера. Полная палитра — в src/input.css;
// здесь только id и основной цвет для <meta name="theme-color">, чтобы
// сервер сразу отдавал страницу в цвете мастера, без мигания.
const THEME_PRIMARY = {
  plum: '#5b3a5e',
  rose: '#9a4a5e',
  wine: '#7a2e4a',
  olive: '#56673f',
  sand: '#86563a',
  ink: '#363a48',
  peach: '#a9502f',
  mint: '#2d7464',
  ocean: '#2c5e88'
};

const THEMES = Object.keys(THEME_PRIMARY);
const DEFAULT_THEME = 'plum';

function themeOf(id) {
  return THEMES.includes(id) ? id : DEFAULT_THEME;
}

module.exports = { THEMES, THEME_PRIMARY, DEFAULT_THEME, themeOf };
