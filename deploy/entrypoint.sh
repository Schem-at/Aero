#!/bin/sh
set -e

# Ensure data directory exists for SQLite
mkdir -p /data

CERT_DIR="/etc/aero/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

# Generate self-signed certs if none provided
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "==> No TLS certs found, generating self-signed..."
  mkdir -p "$CERT_DIR"
  DOMAIN="${DOMAIN:-localhost}"
  openssl ecparam -name prime256v1 -genkey -noout -out "$KEY_FILE" 2>/dev/null
  openssl req -new -x509 -key "$KEY_FILE" -out "$CERT_FILE" \
    -days 14 -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN,IP:127.0.0.1" 2>/dev/null
  echo "==> Self-signed cert generated for $DOMAIN"
fi

echo "==> Starting Aero (TCP=${TCP_PORT:-25565}, WT=${WT_PORT:-4433}, Web=${WEB_PORT:-80})..."
exec /usr/local/bin/proxy \
  --port "${TCP_PORT:-25565}" \
  --wt-port "${WT_PORT:-4433}" \
  --api-port "${API_PORT:-9090}" \
  --web-port "${WEB_PORT:-80}" \
  --domain "${DOMAIN:-localhost}" \
  --cert "$CERT_FILE" \
  --key "$KEY_FILE" \
  --web-dir "/var/www/html"
