# Stage 1: Build WASM from Rust
FROM rust:bookworm AS rust-builder
RUN rustup target add wasm32-unknown-unknown
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
WORKDIR /app/server
# Cache dependencies
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo "pub fn dummy() {}" > src/lib.rs && \
    cargo build --target wasm32-unknown-unknown --release 2>/dev/null || true
# Build actual WASM
COPY server/src ./src
RUN wasm-pack build --target web --out-dir /wasm-output

# Stage 2: Build web frontend
FROM oven/bun:latest AS web-builder
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ .
COPY --from=rust-builder /wasm-output ./public/wasm
# Build args for WebTransport config (empty = auto-detect from window.location)
ARG VITE_WT_PORT=4433
ARG VITE_WT_HOST=""
ARG VITE_CERT_HASH=""
RUN bun run build

# Stage 3: Build Go proxy
FROM golang:bookworm AS go-builder
WORKDIR /app/proxy
COPY proxy/go.mod proxy/go.sum ./
RUN go mod download
COPY proxy/ .
RUN CGO_ENABLED=0 go build -o /proxy-bin ./cmd/proxy

# Stage 4: Runtime (minimal — Go binary serves everything)
FROM alpine:3.21
RUN apk add --no-cache openssl ca-certificates wget

COPY --from=web-builder /app/web/dist /var/www/html
COPY --from=go-builder /proxy-bin /usr/local/bin/proxy
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Web UI (80), WebTransport (4433 UDP+TCP), Minecraft (25565 TCP), Metrics (9090)
EXPOSE 80 4433/udp 4433/tcp 25565 9090

ENTRYPOINT ["/entrypoint.sh"]
