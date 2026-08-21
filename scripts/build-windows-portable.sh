#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22.13.0}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
STAGE="$(mktemp -d)"
NODE_ZIP="$STAGE/node-win.zip"
PACKAGE_ROOT="$STAGE/PolymarketBTC15mAssistant"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$PACKAGE_ROOT" "$OUT_DIR"

git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$PACKAGE_ROOT"
rm -rf "$PACKAGE_ROOT/logs" "$PACKAGE_ROOT/dist"
mkdir -p "$PACKAGE_ROOT/logs"

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip" -o "$NODE_ZIP"
unzip -q "$NODE_ZIP" -d "$STAGE/node-unpacked"
mv "$STAGE/node-unpacked/node-v${NODE_VERSION}-win-x64" "$PACKAGE_ROOT/windows-portable/runtime"

rm -rf "$PACKAGE_ROOT/windows-portable/runtime/node_modules"
(cd "$PACKAGE_ROOT" && npm ci --omit=dev --ignore-scripts)

ARCHIVE="$OUT_DIR/PolymarketBTC15mAssistant-win-x64-portable.zip"
rm -f "$ARCHIVE"
(cd "$STAGE" && zip -qr "$ARCHIVE" PolymarketBTC15mAssistant)
printf 'Created %s\n' "$ARCHIVE"
