resource "yandex_cm_certificate" "site" {
  count     = var.domain == "" ? 0 : 1
  folder_id = data.yandex_client_config.client.folder_id
  name      = "booking-cert"
  domains   = [var.domain]

  managed {
    challenge_type = "DNS_CNAME"
  }
}

resource "yandex_api_gateway" "site" {
  count       = var.deploy_function ? 1 : 0
  folder_id   = data.yandex_client_config.client.folder_id
  name        = "booking"
  description = "HTTPS-вход: статика из бакета, страницы и API из функции"

  spec = templatefile("${path.module}/../../api/openapi.yaml", {
    function_id   = yandex_function.api[0].id
    gateway_sa_id = yandex_iam_service_account.gateway.id
    bucket        = yandex_storage_bucket.site.bucket
  })

  dynamic "custom_domains" {
    for_each = var.domain == "" ? [] : [var.domain]
    content {
      fqdn           = custom_domains.value
      certificate_id = yandex_cm_certificate.site[0].id
    }
  }
}
