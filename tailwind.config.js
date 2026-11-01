module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      colors: {
        tg: 'rgb(var(--c-tg) / <alpha-value>)',
        ios: 'rgb(var(--c-ios) / <alpha-value>)',
        milk: 'rgb(var(--c-milk) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
