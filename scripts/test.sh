#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Running Rust tests..."
cd "$ROOT/server"
cargo test

echo ""
echo "==> Running Go proxy tests..."
cd "$ROOT/proxy"
go test ./...

echo ""
echo "==> All tests passed."
