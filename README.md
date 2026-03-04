# minecraft-web-server

A Minecraft Java Edition server that runs entirely in the browser via WebAssembly. Players connect with standard Minecraft clients through a Go proxy that bridges TCP to WebTransport.

```
Minecraft Client (TCP)
  --> Go Proxy (subdomain routing)
    --> WebTransport (HTTP/3 / QUIC)
      --> Browser (React UI + Rust WASM server)
```

## Architecture

### Rust WASM Server (`server/`)

The core Minecraft protocol implementation, compiled to WebAssembly. Handles the full connection lifecycle: handshake, server list ping, authentication (RSA + AES encryption, Mojang session verification), configuration, and play state. Runs inside the browser as a WASM module.

Key capabilities:
- Minecraft protocol 774 (1.21.11)
- Packet framing, VarInt encoding, zlib compression
- RSA key exchange and AES-CFB8 stream encryption
- Mojang authentication (session server verification delegated to JS)
- NBT encoding for registries, world data, and chat
- Server List Ping with configurable MOTD, favicon, and player count
- Flat world generation with chunk streaming
- Bidirectional chat (player messages + server-sent System Chat)

### Go Proxy (`proxy/`)

Bridges standard Minecraft TCP connections to WebTransport streams. When a Minecraft client connects, the proxy reads the handshake packet, extracts the subdomain from the server address (e.g., `room123.localhost`), looks up the corresponding browser session, and opens a WebTransport stream to forward traffic bidirectionally.

Components:
- **TCP Listener** — Accepts Minecraft client connections, parses handshake for subdomain routing
- **WebTransport Server** — HTTP/3 endpoint that browser sessions connect to, with TLS certificate pinning
- **Router** — Maps subdomains to active browser sessions
- **Bridge** — Bidirectional byte forwarding between TCP and WebTransport streams

### React Frontend (`web/`)

A React + Tailwind CSS dashboard for operating the server from the browser. Built with Vite, uses ShadCN-style components.

Features:
- Start/stop server controls with WASM lifecycle management
- Real-time server console with categorized, color-coded log entries
- Chat panel for sending and receiving Minecraft chat messages
- Packet inspector with hex dumps and per-packet timing
- Live stats (TPS, MSPT, packets/sec, bandwidth, uptime)
- Server settings (MOTD, max players, version string, favicon upload)

The frontend initializes WebTransport to the proxy, then processes all incoming Minecraft packets through the WASM module. A mutex serializes WASM access when multiple clients connect simultaneously.

## Prerequisites

- [Rust](https://rustup.rs/) + `wasm-pack` (`cargo install wasm-pack`)
- [Go](https://go.dev/) 1.21+
- [Bun](https://bun.sh/)
- OpenSSL (for TLS cert generation)

## Quick Start

```bash
# Install web dependencies
cd web && bun install && cd ..

# Start everything (builds WASM, starts proxy + web server, watches for changes)
./scripts/dev.sh
```

This will:
1. Generate self-signed TLS certificates (first run only)
2. Build the Rust server to WASM (`web/public/wasm/`)
3. Start the Go proxy (TCP + WebTransport)
4. Start the Vite dev server with hot reload
5. Watch Rust source files and rebuild WASM on changes

Once running:
- **Web UI**: http://localhost:5555
- **Minecraft TCP**: localhost:25580
- **WebTransport**: localhost:4433

### Connecting a Minecraft Client

1. Open the web UI and click **Start Server**
2. In Minecraft Java Edition (1.21.11), add a server: `localhost:25580`
3. The server appears in the server list with your configured MOTD
4. Join the server — you'll authenticate, load into a flat world, and can chat

## Configuration

Copy `.env.example` to `.env` to customize ports:

```
TCP_PORT=25580    # Minecraft clients connect here
WT_PORT=4433      # WebTransport/QUIC port
DOMAIN=localhost  # Base domain for subdomain routing
WEB_PORT=5555     # Vite dev server port
```

## Project Structure

```
minecraft-web-server/
├── server/                 # Rust WASM crate
│   └── src/
│       ├── lib.rs          # WASM exports (handle_packet, queue_chat, etc.)
│       ├── connection.rs   # Connection state machine + packet dispatch
│       ├── protocol/       # Minecraft protocol (packets, handlers, types)
│       ├── crypto.rs       # RSA + AES encryption
│       ├── compression.rs  # Zlib packet compression
│       ├── nbt.rs          # Network NBT encoder
│       ├── registry.rs     # Minecraft data registries
│       └── world.rs        # World/chunk generation
├── proxy/                  # Go proxy
│   ├── cmd/proxy/main.go   # Entry point with CLI flags
│   └── internal/
│       ├── transport/      # WebTransport server
│       ├── tcp/            # TCP listener + handshake parsing
│       ├── router/         # Subdomain session routing
│       └── bridge/         # Bidirectional forwarding
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components (Console, Chat, Packets, Stats)
│   │   ├── context/        # React contexts (Server, Logs, Stats)
│   │   ├── lib/            # WASM loader + WebTransport client
│   │   └── types/          # TypeScript types
│   └── public/wasm/        # WASM build output (gitignored)
└── scripts/
    ├── dev.sh              # Development environment
    ├── build.sh            # Production build
    ├── generate-certs.sh   # TLS certificate generation
    └── test.sh             # Test runner
```

## Scripts

| Script | Description |
|--------|-------------|
| `./scripts/dev.sh` | Start full dev environment with file watching |
| `./scripts/build.sh` | Production build (WASM + web + proxy) |
| `./scripts/test.sh` | Run Rust tests |
| `./scripts/generate-certs.sh` | Generate self-signed TLS certs for WebTransport |

## How It Works

**Connection flow:**

1. Browser opens WebTransport session to the Go proxy, registering a room name
2. Minecraft client connects to `room.localhost:25580` via TCP
3. Proxy reads the handshake, extracts subdomain `room`, finds the browser session
4. Proxy opens a new WebTransport stream and replays the handshake bytes
5. Browser receives bytes on the stream, passes them to WASM `handle_packet()`
6. WASM processes the Minecraft protocol (handshake → login → encryption → config → play)
7. Response bytes flow back: WASM → WebTransport stream → proxy → TCP → Minecraft client
8. For Mojang authentication, the browser fetches the session server API and feeds the response back to WASM

**WASM ↔ JavaScript bridge:**

The Rust WASM module communicates with JavaScript through:
- **Exports**: `handle_packet`, `reset_state`, `get_stats`, `get_packet_log`, `queue_chat`, etc.
- **Imports**: `window.__mc_server_log(level, category, message)` — logging callback that feeds the React console
