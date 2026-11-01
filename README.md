# БьютиЛинк

БьютиЛинк — красивая страница онлайн-записи для бьюти-мастера: услуги, цены, портфолио, заявка на удобное время, панель мастера (вход через Яндекс ID или Mail.ru) и необязательные уведомления в Telegram без персональных данных клиента.

Настройка входа и переменные окружения: [docs/oauth-setup.md](docs/oauth-setup.md). Юридические страницы: `/privacy`, `/terms-masters`.

Логотип набран шрифтом Cormorant Garamond (SIL Open Font License 1.1, текст лицензии — `fonts/OFL.txt`). Файлы шрифта лежат в `fonts/`, урезаны до латиницы и кириллицы и отдаются с нашего сайта — без Google Fonts.

Как поднять это в Yandex Cloud без правки кода: [docs/DEPLOY_YANDEX_CLOUD.md](docs/DEPLOY_YANDEX_CLOUD.md).

Локально, без облака:

```sh
npm test
node local/server.js
```

Страница примера: http://127.0.0.1:4173/anna
