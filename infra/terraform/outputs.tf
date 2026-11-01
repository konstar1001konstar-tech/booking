output "gateway_domain" {
  description = "Адрес API Gateway без схемы. Сайт: https://<этот адрес>"
  value       = try(yandex_api_gateway.site[0].domain, "")
}

output "site_url" {
  description = "Адрес, который стоит записать в public_url, если свой домен ещё не подключён."
  value       = try("https://${yandex_api_gateway.site[0].domain}", "")
}

output "bucket_name" {
  value = yandex_storage_bucket.site.bucket
}

output "lockbox_secret_id" {
  value = yandex_lockbox_secret.app.id
}

output "function_id" {
  value = try(yandex_function.api[0].id, "")
}

output "ydb_endpoint" {
  value = yandex_ydb_database_serverless.db.ydb_full_endpoint
}

output "storage_access_key" {
  description = "Ключ для загрузки статики. Не публикуйте его."
  value       = yandex_iam_service_account_static_access_key.deploy.access_key
}

output "storage_secret_key" {
  description = "Секрет ключа загрузки. Есть только в state и в выводе terraform output."
  value       = yandex_iam_service_account_static_access_key.deploy.secret_key
  sensitive   = true
}
