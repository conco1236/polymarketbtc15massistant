#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-ubuntu}"
APP_DIR="${APP_DIR:-/opt/polymarketbtc15massistant}"
REPO_URL="${REPO_URL:-https://github.com/conco1236/PolymarketBTC15mAssistant.git}"
BRANCH="${BRANCH:-agent/paper-trading-core}"
SERVICE_NAME="polymarket-agent"
ENV_FILE="/etc/${SERVICE_NAME}.env"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node || true)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-oracle.sh" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates git curl

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js 22+ is required. Install Node.js first, then re-run this script." >&2
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --depth=1 origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "FETCH_HEAD"
else
  rm -rf "$APP_DIR"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

sudo -u "$APP_USER" -- bash -lc "cd '$APP_DIR' && npm ci --omit=dev --ignore-scripts"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$APP_DIR/logs"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'ENV'
# Required for Telegram alerts. Never commit this file.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_MIN_INTERVAL_MS=10000

# Public-data configuration.
POLYMARKET_AUTO_SELECT_LATEST=true
POLYMARKET_SERIES_ID=10192
POLYMARKET_SERIES_SLUG=btc-up-or-down-15m

# Paper-only agent limits.
AGENT_POLICY_VERSION=v1-paper
AGENT_MAX_SPREAD=0.08
AGENT_MIN_LIQUIDITY=100
AGENT_MIN_NET_EDGE=0.05
AGENT_MAX_SIGNAL_AGE_MS=5000
AGENT_COOLDOWN_MS=30000
AGENT_FEE_RATE=0.02
AGENT_SLIPPAGE_RATE=0.02
AGENT_MAX_PAPER_NOTIONAL=100
AGENT_PRICE_TO_BEAT_LATCH_MS=5000
AGENT_LEDGER_PATH=/opt/polymarketbtc15massistant/logs/agent_events.jsonl

# Optional Chainlink fallback.
# POLYGON_RPC_URL=
# POLYGON_RPC_URLS=
# POLYGON_WSS_URLS=
ENV
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo "Created $ENV_FILE. Add Telegram token/chat ID and RPC values, then restart the service."
fi

sed -e "s|__APP_USER__|$APP_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$SCRIPT_DIR/polymarket-agent.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
chmod 644 "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
