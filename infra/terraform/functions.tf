resource "yandex_function" "api" {
  count              = var.deploy_function ? 1 : 0
  folder_id          = data.yandex_client_config.client.folder_id
  name               = "booking-api"
  description        = "Страницы мастеров, заявки, панель и вебхук Telegram"
  runtime            = "nodejs22"
  entrypoint         = "index.handler"
  memory             = 256
  execution_timeout  = 10
  service_account_id = yandex_iam_service_account.functions.id
  user_hash          = filemd5("${path.module}/../../functions/dist/function.zip")

  lifecycle {
    precondition {
      condition     = var.lockbox_version_id != ""
      error_message = "Создайте версию секрета в Lockbox и впишите lockbox_version_id."
    }
  }

  content {
    zip_filename = "${path.module}/../../functions/dist/function.zip"
  }

  environment = {
    YDB_ENDPOINT  = yandex_ydb_database_serverless.db.ydb_full_endpoint
    YDB_DATABASE  = yandex_ydb_database_serverless.db.database_path
    PUBLIC_URL    = var.public_url
    COOKIE_SECURE = "1"
    SET_WEBHOOK   = var.set_webhook ? "1" : "0"
  }

  dynamic "secrets" {
    for_each = {
      bot_token      = "BOT_TOKEN"
      session_secret = "SESSION_SECRET"
      webhook_secret = "WEBHOOK_SECRET"
    }
    content {
      id                   = yandex_lockbox_secret.app.id
      version_id           = var.lockbox_version_id
      key                  = secrets.key
      environment_variable = secrets.value
    }
  }
}
