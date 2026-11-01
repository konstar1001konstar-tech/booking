resource "yandex_function" "api" {
  count              = var.deploy_function ? 1 : 0
  folder_id          = data.yandex_client_config.client.folder_id
  name               = "booking-api"
  description        = "Страницы мастеров, заявки, панель и вебхук Telegram"
  runtime            = "nodejs22"
  entrypoint         = "index.handler"
  memory             = 256
  execution_timeout  = 25
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

  # Yandex Cloud rejects empty environment values, so unset ones are dropped.
  environment = { for k, v in merge(
    {
      STORAGE       = var.storage
      S3_BUCKET     = var.storage == "s3" ? yandex_storage_bucket.site.bucket : ""
      PUBLIC_URL    = var.public_url
      RELAY_URL     = var.relay_url
      RELAY_IPS     = var.relay_url != "" ? var.relay_ips : ""
      COOKIE_SECURE = "1"
      SET_WEBHOOK   = var.set_webhook ? "1" : "0"
    },
    var.storage == "ydb" ? {
      # Host:port only. ydb-sdk also reads YDB_ENDPOINT itself for every
      # connection, so a "?database=..." suffix here breaks gRPC dialing.
      YDB_ENDPOINT = "grpcs://${yandex_ydb_database_serverless.db.ydb_api_endpoint}"
      YDB_DATABASE = yandex_ydb_database_serverless.db.database_path
    } : {}
  ) : k => v if v != "" }

  dynamic "secrets" {
    for_each = merge({
      bot_token      = "BOT_TOKEN"
      session_secret = "SESSION_SECRET"
      webhook_secret = "WEBHOOK_SECRET"
    }, var.relay_url != "" ? { relay_key = "RELAY_KEY" } : {})
    content {
      id                   = yandex_lockbox_secret.app.id
      version_id           = var.lockbox_version_id
      key                  = secrets.key
      environment_variable = secrets.value
    }
  }
}

# Раз в минуту вызывает функцию с событием таймера: она досылает сообщения
# Telegram, которые не ушли сразу (outbox в data/outbox/). Вызывает от имени
# booking-gateway — у него уже есть serverless.functions.invoker на функцию.
resource "yandex_function_trigger" "outbox" {
  count       = var.deploy_function ? 1 : 0
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking-outbox"
  description = "Досылка уведомлений Telegram из outbox"

  timer {
    cron_expression = "* * ? * * *"
  }

  function {
    id                 = yandex_function.api[0].id
    service_account_id = yandex_iam_service_account.gateway.id
  }
}
