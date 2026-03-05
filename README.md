
<p align="center">
  <img src="web/public/logo-dark-512.png" alt="Aero" width="128" height="128">
</p>

<h1 align="center">Aero</h1>

<p align="center">
  A Minecraft Java Edition server that runs entirely in the browser via WebAssembly.<br>
  Players connect with standard Minecraft clients through a Go proxy that bridges TCP to WebTransport.
</p>

<p align="center">
  <a href="https://aeromc.dev">aeromc.dev</a>
</p>

---

```
Minecraft Client (TCP)
  :333
  → Aero Proxy (subdomain routing)
    → WebTransport (HTTP/3 / QUIC)
      → Browser (React UI + Rust WASM server)
```

## Features

- **Full Minecraft protocol** — Protocol 774 (1.21.11) with encryption, compression, and Mojang authentication
- **Browser-native** — Rust server compiled to WASM, runs on a Web Worker off the main thread
- **WebGPU world generation** — Write WGSL shaders to generate terrain in real-time on the GPU
- **Multi-page dashboard** — Landing page, server controls, proxy monitoring, and public server list
- **Configurable** — MOTD, favicon, max players, render distance, fog/sky colors, whitelist
- **Public server list** — Toggle your server as public so others can discover and connect
- **Authentication** — Optional JWT-based admin auth with SQLite (Turso) persistence for the proxy dashboard
- **Single binary deployment** — Go proxy serves the React frontend, Mojang API proxy, and all API endpoints
- **Docker ready** — Multi-stage build, single container, Dokploy/Traefik compatible

## Architecture

### Rust WASM Server (`server/`)

The core Minecraft protocol implementation, compiled to WebAssembly. Handles the full connection lifecycle: handshake, server list ping, authentication (RSA + AES encryption, Mojang session verification), configuration, and play state.

- Packet framing, VarInt encoding, zlib compression
- RSA key exchange and AES-CFB8 stream encryption
- NBT encoding for registries, world data, and chat
- Pluggable world generation with chunk streaming
- Bidirectional chat and player whitelist enforcement

### Go Proxy (`proxy/`)

Bridges standard Minecraft TCP connections to WebTransport streams. When a Minecraft client connects, the proxy reads the handshake packet, extracts the subdomain from the server address (e.g., `room.aeromc.dev`), and forwards traffic bidirectionally to the corresponding browser session.

- **TCP Listener** — Accepts Minecraft clients, parses handshake for subdomain routing
- **WebTransport Server** — HTTP/3 endpoint for browser sessions with TLS certificate pinning
- **Router** — Maps subdomains to active browser sessions
- **Bridge** — Bidirectional byte forwarding between TCP and WebTransport
- **Metrics** — JSON API for proxy monitoring (active rooms, connections, bandwidth)
- **Auth** — JWT authentication with SQLite (Turso) storage and rate limiting
- **Web Server** — Serves the React frontend with SPA fallback and Mojang API reverse proxy

### React Frontend (`web/`)

A multi-page React + Tailwind CSS application built with Vite.

**Pages:**
- **Landing** — Hero page with project overview
- **Server** — Start/stop controls, console, chat, packet inspector, stats, settings, world gen editor
- **Proxy Dashboard** — Real-time proxy monitoring with sparkline charts (auth-gated)
- **Public Servers** — Browse and connect to public servers
- **Login** — Admin authentication for the proxy dashboard

**Server page features:**
- Real-time console with categorized, color-coded log entries
- Chat panel for sending and receiving Minecraft messages
- Packet inspector with hex dumps and per-packet timing
- Live stats (TPS, MSPT, packets/sec, bandwidth, uptime)
- Settings panel (MOTD, favicon, max players, render distance, colors, whitelist)
- World generation editor with WGSL shader support (WebGPU compute)
- Plugin system for extensible world generators

## Prerequisites

- [Rust](https://rustup.rs/) + `wasm-pack` (`cargo install wasm-pack`)
- [Go](https://go.dev/) 1.21+
- [Bun](https://bun.sh/)
- OpenSSL (for TLS cert generation)

## Quick Start

```bash
# Install web dependencies
cd web && bun install && cd ..

# Start everything (builds WASM, starts proxy + Vite, watches for changes)
./scripts/dev.sh
```

This will:
1. Generate self-signed TLS certificates (first run only)
2. Build the Rust server to WASM
3. Start the Go proxy (TCP + WebTransport + API)
4. Start the Vite dev server with hot reload
5. Watch Rust source files and rebuild WASM on changes

Once running:
- **Web UI**: http://localhost:5555
- **Minecraft TCP**: `localhost:25580`
- **WebTransport**: `localhost:4433`

### Connecting a Minecraft Client

1. Open the web UI and click **Start Server**
2. In Minecraft Java Edition (1.21.11), add a server: `localhost:25580`
3. The server appears in the server list with your configured MOTD and favicon
4. Join — you'll authenticate, load into a generated world, and can chat

## Configuration

Copy `.env.example` to `.env` to customize:

```
TCP_PORT=25580       # Minecraft clients connect here
WT_PORT=4433         # WebTransport/QUIC port
DOMAIN=localhost     # Base domain for subdomain routing
WEB_PORT=5555        # Vite dev server port

# Auth (optional — enables proxy dashboard login)
ADMIN_USER=admin     # Seed admin username
ADMIN_PASS=admin     # Seed admin password
JWT_SECRET=secret    # JWT signing key
DB_PATH=./aero.db    # SQLite database path (omit for in-memory)
```

## Deployment

### Docker

```bash
docker compose up --build
```

The multi-stage Dockerfile builds WASM (Rust) → frontend (Bun) → proxy (Go) → Alpine runtime in a single image. The Go binary serves everything: static files, API endpoints, WebTransport, and TCP listener.

### Dokploy / Traefik

The included `docker-compose.yml` is configured for Dokploy deployment:
- Web UI served through Traefik with Let's Encrypt TLS
- WebTransport (UDP+TCP 4433) and Minecraft (TCP 25565) exposed directly
- SQLite database persisted at `../files/data/`
- TLS certs persisted at `../files/certs/`

Set environment variables in Dokploy: `DOMAIN`, `ADMIN_USER`, `ADMIN_PASS`, `JWT_SECRET`.

## Project Structure

```
aero/
├── server/                 # Rust WASM crate
│   └── src/
│       ├── lib.rs          # WASM exports (handle_packet, build_chunk, etc.)
│       ├── connection.rs   # Connection state machine + packet dispatch
│       ├── protocol/       # Minecraft protocol (packets, handlers, types)
│       ├── crypto.rs       # RSA + AES encryption
│       ├── compression.rs  # Zlib packet compression
│       ├── nbt.rs          # Network NBT encoder
│       ├── registry.rs     # Minecraft data registries
│       ├── stats.rs        # Server config + metrics
│       └── world.rs        # World/chunk data
├── proxy/                  # Go proxy
│   ├── cmd/proxy/main.go   # Entry point
│   └── internal/
│       ├── transport/      # WebTransport server
│       ├── tcp/            # TCP listener + handshake parsing
│       ├── router/         # Subdomain → session routing
│       ├── bridge/         # Bidirectional forwarding
│       ├── metrics/        # JSON stats API
│       ├── auth/           # JWT auth + bcrypt + HTTP handlers
│       ├── db/             # SQLite (Turso) admin storage
│       └── ratelimit/      # Per-IP token bucket rate limiter
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI (Console, Chat, Packets, Stats, Settings, WorldGen)
│   │   ├── context/        # React contexts (Server, Log, Stats, Config, Plugin, Worker, Auth)
│   │   ├── pages/          # Landing, Server, ProxyDashboard, Servers, Login
│   │   ├── workers/        # Web Worker (WASM + WebTransport)
│   │   ├── plugins/        # World generators (flat, shader)
│   │   ├── lib/            # Server bridge + utilities
│   │   └── types/          # TypeScript types
│   └── public/             # Logo assets, favicon, WASM output
├── deploy/
│   └── entrypoint.sh       # Docker entrypoint
├── scripts/
│   ├── dev.sh              # Development environment
│   ├── build.sh            # Production build
│   └── generate-certs.sh   # TLS certificate generation
├── Dockerfile              # Multi-stage build
└── docker-compose.yml      # Dokploy-ready deployment
```

## How It Works

**Connection flow:**

1. Browser opens a WebTransport session to the Go proxy, registering a room name
2. Minecraft client connects to `room.aeromc.dev:25565` via TCP
3. Proxy reads the handshake, extracts subdomain `room`, finds the browser session
4. Proxy opens a new WebTransport stream and replays the handshake bytes
5. Browser's Web Worker receives bytes, passes them to WASM `handle_packet()`
6. WASM processes the protocol (handshake → login → encryption → config → play)
7. Response bytes flow back: WASM → WebTransport → proxy → TCP → client
8. For Mojang auth, the worker fetches the session server API and feeds the response back to WASM

**Chunk generation flow:**

1. Player joins or moves to a new chunk → WASM requests chunks
2. Worker posts `chunks_needed` to main thread
3. Plugin system generates block data (FlatGenerator or WebGPU ShaderGenerator)
4. Block state arrays transfer back to the worker
5. Worker calls WASM `build_chunk()` to serialize into encrypted protocol bytes
6. Chunks stream to the client, followed by batch finish packets
