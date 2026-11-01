variable "bucket_name" {
  type        = string
  description = "Имя бакета Object Storage. Должно быть уникальным во всём Yandex Cloud: латиница, цифры и дефис."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$", var.bucket_name))
    error_message = "Имя бакета: 4–63 символа, латиница в нижнем регистре, цифры, точка или дефис."
  }
}

variable "lockbox_version_id" {
  type        = string
  default     = ""
  description = "ID версии секрета Lockbox. Пусто, пока версия не создана в консоли."
}

variable "deploy_function" {
  type        = bool
  default     = false
  description = "true после версии Lockbox и сборки functions/dist/function.zip. До этого создаются бакет, база и секрет."
}

variable "public_url" {
  type        = string
  default     = ""
  description = "Адрес сайта без слэша в конце, например https://xxxx.apigw.yandexcloud.net. Пусто до первого запуска."
}

variable "set_webhook" {
  type        = bool
  default     = true
  description = "При первом открытии /api/health функция регистрирует вебхук бота. Адрес берётся из public_url или из адреса, который открыли."
}

variable "domain" {
  type        = string
  default     = ""
  description = "Свой домен, например zapis.example.ru. Пусто — сайт открывается на адресе API Gateway."
}

variable "storage" {
  type        = string
  default     = "s3"
  description = "Где хранить данные: s3 — JSON-объекты в бакете (префикс data/), ydb — таблицы YDB."

  validation {
    condition     = contains(["s3", "ydb"], var.storage)
    error_message = "storage: s3 или ydb."
  }
}

variable "relay_url" {
  type        = string
  default     = ""
  description = "Релей Telegram Bot API, например https://booking-dun-beta.vercel.app/api/tg. Пусто — функция ходит в api.telegram.org напрямую. Если задан, в Lockbox нужен ключ relay_key."
}

variable "relay_ips" {
  type        = string
  default     = "76.76.21.21"
  description = "IPv4 релея через запятую, к которым функция подключается напрямую (имя хоста остаётся для TLS). Из Yandex Cloud новые адреса Vercel 216.198.79.x и 64.29.17.x часто не отвечают, а 76.76.21.21 работает. Пусто — обычный DNS."
}

variable "webhook_url" {
  type        = string
  default     = "https://booking-dun-beta.vercel.app/api/tg-hook"
  description = "Адрес вебхука бота. По умолчанию — пересылка на Vercel (api/tg-hook.js), потому что серверы Telegram не всегда достают до Yandex Cloud. Пусто — вебхук прямо на адрес сайта (/api/telegram/webhook)."
}

variable "allow_telegram_login" {
  description = "Вход в панель через Telegram (ссылка от бота и виджет). Выключите после того, как владелец привяжет Яндекс ID или Mail.ru."
  type        = bool
  default     = true
}

variable "yandex_client_id" {
  description = "ClientID приложения Яндекс ID (oauth.yandex.ru). Пусто — кнопка «Яндекс ID» скрыта."
  type        = string
  default     = ""
}

variable "yandex_client_secret_in_lockbox" {
  description = "true, когда в секрет booking-secrets добавлен ключ yandex_client_secret (Client secret Яндекс ID)."
  type        = bool
  default     = false
}

variable "vkid_client_id" {
  description = "ID приложения VK ID (id.vk.ru) для входа через Mail.ru. Пусто — кнопка скрыта."
  type        = string
  default     = ""
}

variable "owner_fio" {
  description = "ФИО владельца сервиса (самозанятый) для подвала, политики и согласия."
  type        = string
  default     = ""
}

variable "owner_inn" {
  description = "ИНН владельца сервиса."
  type        = string
  default     = ""
}

variable "owner_email" {
  description = "Почта для обращений по персональным данным."
  type        = string
  default     = ""
}

variable "bot_username" {
  description = "Имя бота без @ — для ссылки «Подключить Telegram»."
  type        = string
  default     = "Online_ZaPiS_nA_bot"
}

variable "retention_months" {
  description = "Через сколько месяцев после даты визита заявка удаляется."
  type        = number
  default     = 12
}
