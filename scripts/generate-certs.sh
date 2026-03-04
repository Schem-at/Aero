#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/proxy/certs"
ENV_FILE="$ROOT/web/.env.local"

mkdir -p "$CERT_DIR"

# Generate self-signed ECDSA P-256 cert (14-day validity per WebTransport spec)
openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/key.pem" 2>/dev/null
openssl req -new -x509 -key "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
  -days 14 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" 2>/dev/null

# Compute SHA-256 hash of the DER-encoded certificate for browser pinning
CERT_HASH=$(openssl x509 -in "$CERT_DIR/cert.pem" -outform der 2>/dev/null | openssl dgst -sha256 -binary | base64)

# Write cert hash to Vite env file
echo "VITE_CERT_HASH=$CERT_HASH" > "$ENV_FILE"

echo "==> Certificates generated:"
echo "    cert: $CERT_DIR/cert.pem"
echo "    key:  $CERT_DIR/key.pem"
echo "    hash: $CERT_HASH"
