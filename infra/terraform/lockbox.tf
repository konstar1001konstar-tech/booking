resource "yandex_lockbox_secret" "app" {
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking-secrets"
  description = "bot_token, session_secret, webhook_secret. Значения задаются версией в консоли, не в этом файле."
}
