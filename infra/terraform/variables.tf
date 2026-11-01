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
