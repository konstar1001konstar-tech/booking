#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

if [ ! -f "$root/functions/package-lock.json" ]; then
  echo "Нет functions/package-lock.json" >&2
  exit 1
fi

cp "$root/functions/index.js" "$stage/index.js"
cp "$root/functions/package.json" "$stage/package.json"
cp "$root/functions/package-lock.json" "$stage/package-lock.json"
cp -a "$root/functions/src" "$stage/src"
cp "$root/index.html" "$stage/index.html"
cp "$root/calendar.js" "$stage/calendar.js"
mkdir -p "$root/functions/dist"
(
  cd "$stage"
  rm -f "$root/functions/dist/function.zip"
  zip -qr "$root/functions/dist/function.zip" .
)
echo "$root/functions/dist/function.zip"
