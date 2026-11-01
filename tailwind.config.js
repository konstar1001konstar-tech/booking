module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        tg: 'rgb(var(--c-tg) / <alpha-value>)',
        ios: 'rgb(var(--c-ios) / <alpha-value>)',
        milk: 'rgb(var(--c-milk) / <alpha-value>)',
        'tg-dark': 'rgb(var(--c-tg-dark) / <alpha-value>)',
        ontg: 'rgb(var(--c-on-tg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        hero: 'rgb(var(--c-hero) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
