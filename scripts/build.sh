#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building Rust WASM..."
cd "$ROOT/server"
wasm-pack build --target web --out-dir "$ROOT/web/public/wasm"

echo "==> Building web app..."
cd "$ROOT/web"
bun run build

echo "==> Building Go proxy..."
cd "$ROOT/proxy"
go build -o "$ROOT/bin/proxy" ./cmd/proxy

echo "==> Done. Outputs:"
echo "    bin/proxy"
echo "    web/public/wasm/"
echo "    web/dist/"
