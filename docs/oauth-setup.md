# Вход через Яндекс ID и Mail.ru — настройка с iPhone

Оба провайдера бесплатные и российские (разрешены для входа на сайты по
ч. 10 ст. 8 149-ФЗ). Пока client_id не задан, кнопка на сайте скрыта —
ничего не ломается. Вход через Telegram работает, пока
`allow_telegram_login = true`.

Адрес сайта (шлюз): `https://d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net`

| Провайдер | Redirect URI (вставить точно, без слеша в конце) |
|---|---|
| Яндекс ID | `https://d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net/api/auth/yandex/callback` |
| Mail.ru (VK ID) | `https://d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net/api/auth/vkid/callback` |

## 1. Яндекс ID (≈5 минут)

1. В Safari откройте **oauth.yandex.ru/client/new** и войдите своим Яндекс ID.
2. Название сервиса: `БьютиЛинк`. Иконку можно не загружать.
3. Платформа: отметьте **«Веб-сервисы»**.
4. В поле **Redirect URI** вставьте адрес для Яндекса из таблицы выше.
   Поле Suggest Hostname — `d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net`.
5. Доступ к данным: оставьте только **«Доступ к логину, имени и фамилии, полу»**
   (`login:info`). Почту, телефон и прочее не включайте — они не нужны.
6. Почта для связи — ваша. Нажмите **«Создать приложение»**.
7. На странице приложения скопируйте **ClientID** — пришлите его мне в чат
   (он не секретный).
8. **Client secret** — секретный, в чат его не присылайте. Откройте
   console.yandex.cloud → Lockbox → `booking-secrets` → «Создать новую
   версию» → «Добавить значение»: ключ `yandex_client_secret`, значение —
   Client secret. Проверьте, что прежние ключи (bot_token, session_secret,
   webhook_secret, relay_key) остались в версии, и сохраните. Напишите мне
   «секрет Яндекса добавлен» — я обновлю версию Lockbox в настройках и включу
   кнопку.

## 2. Mail.ru через VK ID (≈10 минут + подтверждение)

С 1 июля 2025 года Mail.ru не регистрирует новые сайты в старом OAuth Mail —
вход через почту Mail.ru для новых сайтов включается в кабинете VK ID
(та же компания VK). Пользователь видит окно входа Mail.ru.

1. В Safari откройте **id.vk.ru/business/go** и войдите (VK ID можно создать
   по номеру телефона или почте Mail.ru).
2. Создайте профиль VK Бизнес ID: тип **«Физическое лицо» → «Самозанятый»**
   (или «Резидент РФ»).
3. **Подтвердите профиль** через Госуслуги, Сбер ID или Т-ID — это несколько
   минут. Сделать нужно в течение 60 дней, иначе приложения заблокируют.
4. Раздел **«Приложения» → «Добавить приложение»**. Название `БьютиЛинк`,
   платформа **Web**.
5. **Базовый домен:** `d5dhbg1gjhfegcfobti1.3rspsmhh.apigw.yandexcloud.net`.
   **Доверенный Redirect URL:** адрес для VK ID из таблицы выше.
6. Создайте приложение. В его настройках откройте **«Авторизация» →
   «Дополнительные способы входа»** и включите **«Авторизация через Mail»**
   (Одноклассники можно не включать). Доступы — только базовые
   (`vkid.personal_info`), почту и телефон не запрашивайте.
7. Скопируйте **ID приложения** (число) и пришлите мне в чат — он не
   секретный. Защищённый и сервисный ключи не нужны (вход идёт по PKCE).

## 3. Что я сделаю после ваших ID

```
# infra/terraform/terraform.tfvars
yandex_client_id                = "<ClientID>"
yandex_client_secret_in_lockbox = true
lockbox_version_id              = "<новая версия>"
vkid_client_id                  = "<ID приложения>"
owner_fio   = "<ФИО>"
owner_inn   = "<ИНН>"
owner_email = "<почта для обращений>"
```

`terraform apply` — кнопки появятся на `/admin` и в панели («Привязать
Яндекс ID / Mail.ru»).

## 4. Переход без Telegram-входа

1. Войдите в панель как обычно (ссылка от бота) → блок «Вход и уведомления»
   → **«Привязать Яндекс ID»** или **«Привязать Mail.ru»**.
2. Выйдите и войдите снова через новую кнопку — откроется та же страница.
3. Когда привяжут все мастера из Telegram, поставьте
   `allow_telegram_login = false` и `terraform apply`. Бот перестанет
   присылать ссылки входа, `/api/admin/session` и
   `/api/admin/telegram-widget` закроются; уведомления о заявках останутся.

## Переменные окружения функции

| Переменная | Откуда | Смысл |
|---|---|---|
| `YANDEX_CLIENT_ID` | tfvars `yandex_client_id` | ClientID Яндекс ID |
| `YANDEX_CLIENT_SECRET` | Lockbox `booking-secrets`, ключ `yandex_client_secret` | Client secret Яндекс ID |
| `VKID_CLIENT_ID` | tfvars `vkid_client_id` | ID приложения VK ID (вход Mail.ru) |
| `ALLOW_TELEGRAM_LOGIN` | tfvars `allow_telegram_login` (по умолчанию `true`) | вход через бота и виджет |
| `OWNER_FIO`, `OWNER_INN`, `OWNER_EMAIL` | tfvars `owner_*` | реквизиты владельца в подвале, /privacy, согласии |
| `BOT_USERNAME` | tfvars `bot_username` | ссылка «Подключить Telegram» |
| `RETENTION_MONTHS` | tfvars `retention_months` (12) | срок хранения заявок после визита |
| `RATE_SECRET` | необязательно | ключ HMAC для счётчиков; по умолчанию выводится из `SESSION_SECRET` |

Новые функции работают с `STORAGE=s3` (текущий режим). YDB-репозиторий не
менялся.
