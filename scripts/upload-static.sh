#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root/infra/terraform"

if [ -z "${BUCKET:-}" ]; then
  BUCKET=$(terraform output -raw bucket_name)
fi
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  AWS_ACCESS_KEY_ID=$(terraform output -raw storage_access_key)
  export AWS_ACCESS_KEY_ID
fi
if [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  AWS_SECRET_ACCESS_KEY=$(terraform output -raw storage_secret_key)
  export AWS_SECRET_ACCESS_KEY
fi

endpoint="https://storage.yandexcloud.net"
upload() {
  file=$1
  type=$2
  name=$(basename "$file")
  if command -v aws >/dev/null 2>&1; then
    aws --endpoint-url "$endpoint" s3 cp "$file" "s3://$BUCKET/$name" --content-type "$type" --cache-control "public, max-age=300"
  else
    yc storage s3api put-object --bucket "$BUCKET" --key "$name" --body "$file" --content-type "$type" --cache-control "public, max-age=300"
  fi
}

upload "$root/styles.css" "text/css; charset=utf-8"
upload "$root/app.js" "text/javascript; charset=utf-8"
upload "$root/calendar.js" "text/javascript; charset=utf-8"
upload "$root/favicon.svg" "image/svg+xml"
upload "$root/favicon.ico" "image/x-icon"
upload "$root/apple-touch-icon.png" "image/png"
upload "$root/site.webmanifest" "application/manifest+json"
upload "$root/robots.txt" "text/plain; charset=utf-8"
echo "Статика загружена в $BUCKET"
