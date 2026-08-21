#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22.13.0}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
STAGE="$(mktemp -d)"
PACKAGE_ROOT="$STAGE/PolymarketBTC15mAssistant"
NODE_ZIP="$STAGE/node-win.zip"
SEA_ENTRY="$STAGE/sea-entry.cjs"
SEA_MAIN="$STAGE/sea-main.cjs"
SEA_BUNDLE="$STAGE/agent-bundle.cjs"
SEA_CONFIG="$STAGE/sea-config.json"
SEA_BLOB="$STAGE/sea-prep.blob"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$PACKAGE_ROOT/windows-portable" "$OUT_DIR"
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$PACKAGE_ROOT"
rm -rf "$PACKAGE_ROOT/logs" "$PACKAGE_ROOT/dist"
mkdir -p "$PACKAGE_ROOT/logs"

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip" -o "$NODE_ZIP"
unzip -q "$NODE_ZIP" -d "$STAGE/node-unpacked"
mv "$STAGE/node-unpacked/node-v${NODE_VERSION}-win-x64" "$PACKAGE_ROOT/windows-portable/runtime"

(cd "$PACKAGE_ROOT" && npm ci --omit=dev --ignore-scripts)

npx --yes esbuild "$ROOT/windows-portable/sea-entry.cjs" --bundle --platform=node --format=cjs --external:node:* --outfile="$SEA_MAIN"
npx --yes esbuild "$ROOT/src/index.js" --bundle --platform=node --format=cjs --external:node:* --outfile="$SEA_BUNDLE"
cat > "$SEA_CONFIG" <<EOF
{
  "main": "$SEA_MAIN",
  "output": "$SEA_BLOB",
  "assets": { "agent-bundle.cjs": "$SEA_BUNDLE" },
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "useSnapshot": false
}
EOF

node --experimental-sea-config="$SEA_CONFIG"
cp "$PACKAGE_ROOT/windows-portable/runtime/node.exe" "$PACKAGE_ROOT/windows-portable/PolymarketBTC15mAssistant.exe"
npx --yes postject "$PACKAGE_ROOT/windows-portable/PolymarketBTC15mAssistant.exe" NODE_SEA_BLOB "$SEA_BLOB" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
rm -f "$PACKAGE_ROOT/windows-portable/sea-entry.cjs"

ARCHIVE="$OUT_DIR/PolymarketBTC15mAssistant-win-x64-portable-exe.zip"
rm -f "$ARCHIVE"
(cd "$STAGE" && zip -qr "$ARCHIVE" PolymarketBTC15mAssistant)
printf 'Created %s\n' "$ARCHIVE"
