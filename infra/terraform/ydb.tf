resource "yandex_ydb_database_serverless" "db" {
  name                = "booking"
  folder_id           = data.yandex_client_config.client.folder_id
  location_id         = "ru-central1"
  deletion_protection = false
  description         = "Мастера, заявки и лимиты. Данные в ru-central1."
}

locals {
  ydb_connection = yandex_ydb_database_serverless.db.ydb_full_endpoint
}

resource "yandex_ydb_table" "masters" {
  path              = "masters"
  connection_string = local.ydb_connection

  column { name = "slug" type = "Utf8" not_null = true }
  column { name = "chat_id" type = "Utf8" not_null = true }
  column { name = "telegram_user_id" type = "Utf8" not_null = true }
  column { name = "profile_json" type = "Utf8" not_null = true }
  column { name = "published" type = "Bool" not_null = true }
  column { name = "created_at" type = "Utf8" not_null = true }
  column { name = "updated_at" type = "Utf8" not_null = true }

  primary_key = ["slug"]
}

resource "yandex_ydb_table" "masters_by_chat" {
  path              = "masters_by_chat"
  connection_string = local.ydb_connection

  column { name = "chat_id" type = "Utf8" not_null = true }
  column { name = "slug" type = "Utf8" not_null = true }

  primary_key = ["chat_id"]
}

resource "yandex_ydb_table" "bookings" {
  path              = "bookings"
  connection_string = local.ydb_connection

  column { name = "slug" type = "Utf8" not_null = true }
  column { name = "created_at" type = "Utf8" not_null = true }
  column { name = "booking_id" type = "Utf8" not_null = true }
  column { name = "slot_key" type = "Utf8" not_null = true }
  column { name = "client_name" type = "Utf8" not_null = true }
  column { name = "client_phone" type = "Utf8" not_null = true }
  column { name = "service_name" type = "Utf8" not_null = true }
  column { name = "service_price" type = "Uint32" not_null = true }
  column { name = "service_dur" type = "Utf8" not_null = true }
  column { name = "date_iso" type = "Utf8" not_null = true }
  column { name = "time_hhmm" type = "Utf8" not_null = true }
  column { name = "date_text" type = "Utf8" not_null = true }
  column { name = "status" type = "Utf8" not_null = true }
  column { name = "tg_message_id" type = "Utf8" not_null = true }
  column { name = "updated_at" type = "Utf8" not_null = true }

  primary_key = ["slug", "created_at", "booking_id"]
}

resource "yandex_ydb_table" "bookings_by_id" {
  path              = "bookings_by_id"
  connection_string = local.ydb_connection

  column { name = "booking_id" type = "Utf8" not_null = true }
  column { name = "slug" type = "Utf8" not_null = true }
  column { name = "created_at" type = "Utf8" not_null = true }
  column { name = "slot_key" type = "Utf8" not_null = true }
  column { name = "client_name" type = "Utf8" not_null = true }
  column { name = "client_phone" type = "Utf8" not_null = true }
  column { name = "service_name" type = "Utf8" not_null = true }
  column { name = "service_price" type = "Uint32" not_null = true }
  column { name = "service_dur" type = "Utf8" not_null = true }
  column { name = "date_iso" type = "Utf8" not_null = true }
  column { name = "time_hhmm" type = "Utf8" not_null = true }
  column { name = "date_text" type = "Utf8" not_null = true }
  column { name = "status" type = "Utf8" not_null = true }
  column { name = "tg_message_id" type = "Utf8" not_null = true }
  column { name = "updated_at" type = "Utf8" not_null = true }

  primary_key = ["booking_id"]
}

resource "yandex_ydb_table" "slot_holds" {
  path              = "slot_holds"
  connection_string = local.ydb_connection

  column { name = "slug" type = "Utf8" not_null = true }
  column { name = "slot_key" type = "Utf8" not_null = true }
  column { name = "booking_id" type = "Utf8" not_null = true }

  primary_key = ["slug", "slot_key"]
}

resource "yandex_ydb_table" "rate_limits" {
  path              = "rate_limits"
  connection_string = local.ydb_connection

  column { name = "bucket" type = "Utf8" not_null = true }
  column { name = "window_start" type = "Utf8" not_null = true }
  column { name = "count" type = "Uint32" not_null = true }

  primary_key = ["bucket", "window_start"]
}

resource "yandex_ydb_table" "login_tokens" {
  path              = "login_tokens"
  connection_string = local.ydb_connection

  column { name = "jti" type = "Utf8" not_null = true }
  column { name = "slug" type = "Utf8" not_null = true }
  column { name = "chat_id" type = "Utf8" not_null = true }
  column { name = "exp" type = "Utf8" not_null = true }

  primary_key = ["jti"]
}

resource "yandex_ydb_table" "bot_state" {
  path              = "bot_state"
  connection_string = local.ydb_connection

  column { name = "chat_id" type = "Utf8" not_null = true }
  column { name = "step" type = "Utf8" not_null = true }

  primary_key = ["chat_id"]
}
