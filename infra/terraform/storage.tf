resource "yandex_storage_bucket" "site" {
  bucket        = var.bucket_name
  folder_id     = data.yandex_client_config.client.folder_id
  access_key    = yandex_iam_service_account_static_access_key.deploy.access_key
  secret_key    = yandex_iam_service_account_static_access_key.deploy.secret_key
  force_destroy = true

  depends_on = [yandex_resourcemanager_folder_iam_member.deploy_storage]
}
