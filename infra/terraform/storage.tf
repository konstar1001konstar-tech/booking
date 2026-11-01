resource "yandex_storage_bucket" "site" {
  bucket        = var.bucket_name
  folder_id     = data.yandex_client_config.client.folder_id
  access_key    = yandex_iam_service_account_static_access_key.deploy.access_key
  secret_key    = yandex_iam_service_account_static_access_key.deploy.secret_key
  force_destroy = true

  # Счётчики защиты от спама (хэши телефона/IP) живут 2 дня, одноразовые
  # входы — 2 дня, отметки суточной очистки — 30 дней. Заявки удаляет сама
  # функция через RETENTION_MONTHS после даты визита.
  lifecycle_rule {
    id      = "rates-2d"
    enabled = true
    prefix  = "data/rates/"
    expiration {
      days = 2
    }
  }

  lifecycle_rule {
    id      = "logins-2d"
    enabled = true
    prefix  = "data/logins/"
    expiration {
      days = 2
    }
  }

  lifecycle_rule {
    id      = "sweeps-30d"
    enabled = true
    prefix  = "data/sweeps/"
    expiration {
      days = 30
    }
  }

  depends_on = [yandex_resourcemanager_folder_iam_member.deploy_storage]
}
