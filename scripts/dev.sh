#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()

# Load project .env (local overrides, gitignored)
if [ -f "$ROOT/.env" ]; then
  set -a
  source "$ROOT/.env"
  set +a
fi

# Defaults (if not set in .env)
TCP_PORT="${TCP_PORT:-25580}"
WT_PORT="${WT_PORT:-4433}"
DOMAIN="${DOMAIN:-localhost}"
WEB_PORT="${WEB_PORT:-5555}"

# Local auth defaults — uses in-memory SQLite when DB_PATH is not set
export ADMIN_USER="${ADMIN_USER:-admin}"
export ADMIN_PASS="${ADMIN_PASS:-admin}"
export JWT_SECRET="${JWT_SECRET:-dev-secret-do-not-use-in-production!!}"

cleanup() {
  echo ""
  echo "==> Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

# Generate TLS certificates if missing
if [ ! -f "$ROOT/proxy/certs/cert.pem" ]; then
  echo "==> Generating TLS certificates..."
  "$ROOT/scripts/generate-certs.sh"
fi

# Initial WASM build
echo "==> Initial WASM build..."
cd "$ROOT/server"
wasm-pack build --target web --out-dir "$ROOT/web/public/wasm" 2>&1

# Start Go proxy
echo "==> Starting Go proxy..."
cd "$ROOT/proxy"
go run ./cmd/proxy --port "$TCP_PORT" --wt-port "$WT_PORT" --domain "$DOMAIN" \
  --cert certs/cert.pem --key certs/key.pem "$@" &
PIDS+=($!)

# Start Vite dev server
echo "==> Starting Vite dev server..."
cd "$ROOT/web"
bunx vite --port "$WEB_PORT" &
PIDS+=($!)

# Watch Rust files and rebuild WASM on change
echo "==> Watching Rust files for changes..."
(
  cd "$ROOT/server"
  get_hash() {
    find src -name '*.rs' -exec md5 -q {} \; 2>/dev/null | md5
  }
  LAST_HASH="$(get_hash)"
  while true; do
    sleep 3
    HASH="$(get_hash)"
    if [ "$HASH" != "$LAST_HASH" ]; then
      LAST_HASH="$HASH"
      echo "==> Rust files changed, rebuilding WASM..."
      wasm-pack build --target web --out-dir "$ROOT/web/public/wasm" 2>&1 || true
    fi
  done
) &
PIDS+=($!)

echo ""
echo "==> Dev environment running:"
echo "    Web:   http://localhost:$WEB_PORT"
echo "    Proxy: localhost:$TCP_PORT (TCP) / localhost:$WT_PORT (WebTransport)"
echo ""
echo "    Configure ports in .env (see .env.example)"
echo "    Press Ctrl+C to stop all services."
echo ""

wait
