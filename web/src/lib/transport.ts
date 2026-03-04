import type { LogLevel, LogCategory } from "@/types/log";
import { handlePacket, resetState, getPendingAuth, completeAuth } from "@/lib/wasm";

type LogCallback = (
  level: LogLevel,
  category: LogCategory,
  message: string
) => void;

// Mutex to serialize WASM access across concurrent streams
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            const next = this.queue.shift();
            if (next) next();
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

export class WebTransportClient {
  private transport: WebTransport | null = null;
  private log: LogCallback;
  private wasmMutex = new Mutex();
  private abortController: AbortController | null = null;

  constructor(log: LogCallback) {
    this.log = log;
  }

  async connect(url: string): Promise<void> {
    this.log("info", "transport", `Connecting to ${url}...`);

    const certHash = import.meta.env.VITE_CERT_HASH;
    if (!certHash) {
      throw new Error("VITE_CERT_HASH not set — run scripts/generate-certs.sh first");
    }

    // Decode base64 cert hash to Uint8Array for pinning
    const hashBytes = Uint8Array.from(atob(certHash), (c) => c.charCodeAt(0));

    this.transport = new WebTransport(url, {
      serverCertificateHashes: [
        { algorithm: "sha-256", value: hashBytes.buffer },
      ],
    });

    await this.transport.ready;
    this.log("info", "transport", "WebTransport connected");

    this.abortController = new AbortController();

    // Open control stream and send room registration
    await this.registerRoom("default");

    // Listen for incoming bidirectional streams (one per TCP client)
    this.acceptStreams();
  }

  private async registerRoom(room: string): Promise<void> {
    // Open a bidirectional stream as the control stream
    const controlStream = await this.transport!.createBidirectionalStream();
    const controlWriter = controlStream.writable.getWriter();

    const registration = JSON.stringify({ room });
    await controlWriter.write(new TextEncoder().encode(registration));
    this.log("info", "transport", `Registered room: ${room}`);

    // Read confirmation
    const controlReader = controlStream.readable.getReader();
    const { value } = await controlReader.read();
    if (value) {
      const msg = new TextDecoder().decode(value);
      this.log("debug", "transport", `Server confirmed: ${msg}`);
    }
    controlReader.releaseLock();
    controlWriter.releaseLock();
  }

  private async acceptStreams(): Promise<void> {
    if (!this.transport) return;

    const reader = this.transport.incomingBidirectionalStreams.getReader();

    try {
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.handleStream(stream);
      }
    } catch (err) {
      if (this.transport) {
        this.log("warn", "transport", `Stream accept ended: ${err}`);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async handleStream(stream: WebTransportBidirectionalStream): Promise<void> {
    const streamReader = stream.readable.getReader();
    const streamWriter = stream.writable.getWriter();

    this.log("info", "transport", "New client stream accepted");

    // Reset WASM state for this new connection (serialized via mutex)
    const releaseReset = await this.wasmMutex.acquire();
    try {
      resetState();
    } finally {
      releaseReset();
    }

    // Accumulate transport I/O stats, flush periodically
    let rxPackets = 0;
    let rxBytes = 0;
    let txPackets = 0;
    let txBytes = 0;
    const flushStats = () => {
      if (rxPackets > 0 || txPackets > 0) {
        this.log("debug", "transport",
          `I/O: ${rxPackets} recv (${rxBytes}B), ${txPackets} sent (${txBytes}B)`);
        rxPackets = 0; rxBytes = 0; txPackets = 0; txBytes = 0;
      }
    };
    const statsInterval = setInterval(flushStats, 5000);

    try {
      while (true) {
        const { value, done } = await streamReader.read();
        if (done || !value) break;

        rxPackets++;
        rxBytes += value.length;

        // Process packet through WASM (serialized)
        const release = await this.wasmMutex.acquire();
        let response: Uint8Array;
        let pending: string | null;
        try {
          response = handlePacket(value);
          pending = getPendingAuth();
        } finally {
          release();
        }

        // If auth is pending, handle async Mojang API call
        if (pending) {
          const { username, server_hash } = JSON.parse(pending);
          this.log("info", "transport",
            `Authenticating ${username} via Mojang (hash: ${server_hash.substring(0, 8)}...)`);

          try {
            const mojangResp = await fetch(
              `/api/mojang/session/minecraft/hasJoined?username=${encodeURIComponent(username)}&serverId=${encodeURIComponent(server_hash)}`
            );
            const mojangJson = await mojangResp.text();

            // Complete auth (re-acquire mutex for WASM access)
            const releaseAuth = await this.wasmMutex.acquire();
            let loginBytes: Uint8Array;
            try {
              loginBytes = completeAuth(mojangJson);
            } finally {
              releaseAuth();
            }

            if (loginBytes.length > 0) {
              this.log("info", "transport", `Sending Login Success (${loginBytes.length} bytes)`);
              await streamWriter.write(loginBytes);
            }
          } catch (err) {
            this.log("error", "transport", `Mojang auth failed: ${err}`);
          }
        } else if (response.length > 0) {
          txPackets++;
          txBytes += response.length;
          await streamWriter.write(response);
        }
      }
    } catch (err) {
      this.log("debug", "transport", `Stream ended: ${err}`);
    } finally {
      clearInterval(statsInterval);
      flushStats();
      streamReader.releaseLock();
      streamWriter.releaseLock();
    }
  }

  close(): void {
    this.abortController?.abort();
    this.abortController = null;

    if (this.transport) {
      this.transport.close();
      this.transport = null;
      this.log("info", "transport", "Connection closed");
    }
  }
}
