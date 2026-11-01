terraform {
  required_version = ">= 1.5.0"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = ">= 0.140.0"
    }
  }
}

provider "yandex" {
  zone = "ru-central1-a"
}

data "yandex_client_config" "client" {}
