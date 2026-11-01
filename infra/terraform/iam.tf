resource "yandex_iam_service_account" "functions" {
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking-functions"
  description = "Функция записи: база YDB и секрет Lockbox"
}

resource "yandex_iam_service_account" "gateway" {
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking-gateway"
  description = "API Gateway читает бакет и вызывает функцию"
}

resource "yandex_iam_service_account" "deploy" {
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking-deploy"
  description = "Только загрузка файлов сайта из Terraform и скрипта"
}

resource "yandex_resourcemanager_folder_iam_member" "deploy_storage" {
  folder_id = data.yandex_client_config.client.folder_id
  role      = "storage.admin"
  member    = "serviceAccount:${yandex_iam_service_account.deploy.id}"
}

resource "yandex_iam_service_account_static_access_key" "deploy" {
  service_account_id = yandex_iam_service_account.deploy.id
  description        = "Ключ для записи файлов в бакет. Секрет попадает только в terraform.tfstate."
}

resource "yandex_lockbox_secret_iam_binding" "functions_read" {
  secret_id = yandex_lockbox_secret.app.id
  role      = "lockbox.payloadViewer"
  members   = ["serviceAccount:${yandex_iam_service_account.functions.id}"]
}

resource "yandex_ydb_database_iam_binding" "functions_editor" {
  database_id = yandex_ydb_database_serverless.db.id
  role        = "ydb.editor"
  members     = ["serviceAccount:${yandex_iam_service_account.functions.id}"]
}

resource "yandex_storage_bucket_iam_binding" "gateway_read" {
  bucket  = yandex_storage_bucket.site.bucket
  role    = "storage.viewer"
  members = ["serviceAccount:${yandex_iam_service_account.gateway.id}"]
}

resource "yandex_function_iam_binding" "gateway_invoke" {
  count       = var.deploy_function ? 1 : 0
  function_id = yandex_function.api[0].id
  role        = "serverless.functions.invoker"
  members     = ["serviceAccount:${yandex_iam_service_account.gateway.id}"]
}
