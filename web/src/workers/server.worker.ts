/// Server Worker — runs WASM + WebTransport off the main thread.

import type { MainToWorkerMessage, WorkerToMainMessage, WorkerServerConfig } from "@/types/worker-messages";

// Polyfill: wasm-bindgen uses window.__mc_server_log
(globalThis as any).window = globalThis;

// Set up WASM log bridge
(globalThis as any).__mc_server_log = (level: string, category: string, message: string) => {
  postMsg({ type: "log", level: level as any, category: category as any, message });
};

function postMsg(msg: WorkerToMainMessage) {
  self.postMessage(msg);
}

let wasmModule: any = null;
let transport: WebTransport | null = null;
let controlWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let activeStreamWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;

// Whitelist state (updated via set_config messages)
let whitelistEnabled = false;
let whitelist: Set<string> = new Set();

// Serialization queue for chunk operations — ensures cipher ordering
let chunkQueue: Promise<void> = Promise.resolve();

// Track which chunks have been sent to avoid resending
const sentChunks = new Set<string>();
let viewDistance = 10;
let isInitialSpawn = true;
let lastChunkCenterX = 0;
let lastChunkCenterZ = 0;

// Batch-in-flight tracking — prevents nested Chunk Batch Start packets
// which cause the client to receive chunks without rendering them.
let batchInFlight = false;
let pendingChunkRequest = false;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function requestChunks(): void {
  // If a batch is already in flight, defer this request until it completes.
  // This prevents nested Chunk Batch Start packets which cause invisible chunks.
  if (batchInFlight) {
    pendingChunkRequest = true;
    return;
  }

  // Get the center position (from player movement or default 0,0)
  const centerStr = wasmModule.get_pending_chunk_center() as string;
  let centerX = lastChunkCenterX, centerZ = lastChunkCenterZ;
  if (centerStr) {
    const [cx, cz] = centerStr.split(",").map(Number);
    centerX = cx;
    centerZ = cz;
    wasmModule.clear_pending_chunk_center();
  }
  lastChunkCenterX = centerX;
  lastChunkCenterZ = centerZ;

  // Compute which chunks are needed (within view distance of center)
  const needed: { cx: number; cz: number }[] = [];
  const nowVisible = new Set<string>();

  for (let dx = -viewDistance; dx <= viewDistance; dx++) {
    for (let dz = -viewDistance; dz <= viewDistance; dz++) {
      const cx = centerX + dx;
      const cz = centerZ + dz;
      const key = chunkKey(cx, cz);
      nowVisible.add(key);
      if (!sentChunks.has(key)) {
        needed.push({ cx, cz });
        sentChunks.add(key);
      }
    }
  }

  // Prune chunks that are far away from the sentChunks set
  for (const key of sentChunks) {
    if (!nowVisible.has(key)) {
      sentChunks.delete(key);
    }
  }

  batchInFlight = true;

  if (needed.length > 0) {
    enqueueChunkBatchStart();
    postMsg({ type: "chunks_needed", chunks: needed });
  } else {
    // No new chunks needed — send Batch Start + Batch Finished together
    enqueueChunkBatchStart();
    enqueueChunkBatchDone(0);
  }
}

async function initWasm(): Promise<void> {
  if (wasmModule) return;
  // Dynamic import for the WASM module
  const mod = await import("../../public/wasm/aero_server");
  await mod.default();
  wasmModule = mod;
}

async function handleStart(wtUrl: string, config: WorkerServerConfig, subdomain: string): Promise<void> {
  try {
    postMsg({ type: "log", level: "info", category: "system", message: "Starting WASM server module..." });

    await initWasm();
    wasmModule.set_server_config(JSON.stringify(config));
    whitelistEnabled = config.whitelist_enabled ?? false;
    whitelist = new Set((config.whitelist ?? []).map((n: string) => n.toLowerCase()));
    viewDistance = config.render_distance ?? 10;

    postMsg({ type: "log", level: "info", category: "system", message: "WASM initialized, connecting WebTransport..." });

    // Connect WebTransport
    const certHash = (self as any).__CERT_HASH;
    if (!certHash) {
      throw new Error("Certificate hash not provided — pass it in start message or env");
    }

    const hashBytes = Uint8Array.from(atob(certHash), (c: string) => c.charCodeAt(0));
    transport = new WebTransport(wtUrl, {
      serverCertificateHashes: [
        { algorithm: "sha-256", value: hashBytes.buffer },
      ],
    });

    await transport.ready;
    postMsg({ type: "log", level: "info", category: "transport", message: "WebTransport connected" });

    // Register room with preferred subdomain, MOTD, and favicon
    await registerRoom(subdomain || "default", false, config.motd, config.favicon ?? undefined);

    // Start stats polling
    statsInterval = setInterval(pushStats, 500);

    postMsg({ type: "status_change", status: "running" });
    postMsg({ type: "log", level: "info", category: "system", message: "Server running — accepting Minecraft connections" });

    // Accept incoming streams
    acceptStreams();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    postMsg({ type: "status_change", status: "error", error: msg });
    postMsg({ type: "log", level: "error", category: "system", message: `Failed to initialize: ${msg}` });
    if (stack) {
      postMsg({ type: "log", level: "error", category: "system", message: `Stack: ${stack}` });
    }
  }
}

async function registerRoom(room: string, isPublic: boolean = false, motd?: string, favicon?: string): Promise<void> {
  if (!transport) return;
  const controlStream = await transport.createBidirectionalStream();
  const writer = controlStream.writable.getWriter();

  const reg: Record<string, unknown> = { room };
  if (isPublic) reg.public = true;
  if (motd) reg.motd = motd;
  if (favicon) reg.favicon = favicon;
  await writer.write(new TextEncoder().encode(JSON.stringify(reg)));
  postMsg({ type: "log", level: "info", category: "transport", message: `Requesting room: ${room}` });

  const controlReader = controlStream.readable.getReader();
  const { value } = await controlReader.read();
  if (value) {
    const responseText = new TextDecoder().decode(value);
    postMsg({ type: "log", level: "debug", category: "transport", message: `Server confirmed: ${responseText}` });
    try {
      const response = JSON.parse(responseText);
      const assignedRoom = response.room || room;
      postMsg({ type: "room_assigned", room: assignedRoom });
      postMsg({ type: "log", level: "info", category: "transport", message: `Registered room: ${assignedRoom}` });
    } catch {
      postMsg({ type: "room_assigned", room });
    }
  } else {
    postMsg({ type: "room_assigned", room });
  }
  controlReader.releaseLock();

  // Keep control writer for sending updates (public toggle, motd changes)
  controlWriter = writer;
}

async function acceptStreams(): Promise<void> {
  if (!transport) return;
  const reader = transport.incomingBidirectionalStreams.getReader();
  try {
    while (true) {
      const { value: stream, done } = await reader.read();
      if (done) break;
      handleStream(stream);
    }
  } catch (err) {
    if (transport) {
      postMsg({ type: "log", level: "warn", category: "transport", message: `Stream accept ended: ${err}` });
    }
  } finally {
    reader.releaseLock();
  }
}

async function handleStream(stream: WebTransportBidirectionalStream): Promise<void> {
  const streamReader = stream.readable.getReader();
  const streamWriter = stream.writable.getWriter();

  postMsg({ type: "log", level: "info", category: "transport", message: "New client stream accepted" });

  // Reset WASM state for new connection (no mutex needed — worker is single-threaded)
  wasmModule.reset_state();
  sentChunks.clear();
  chunkQueue = Promise.resolve();
  isInitialSpawn = true;
  batchInFlight = false;
  pendingChunkRequest = false;

  try {
    while (true) {
      const { value, done } = await streamReader.read();
      if (done || !value) break;

      // Process packet through WASM
      const response = new Uint8Array(wasmModule.handle_packet(value));

      // Check for pending Mojang auth
      const pendingStr = wasmModule.get_pending_auth() as string;
      if (pendingStr) {
        const { username, server_hash } = JSON.parse(pendingStr);
        postMsg({
          type: "log", level: "info", category: "transport",
          message: `Authenticating ${username} via Mojang (hash: ${server_hash.substring(0, 8)}...)`,
        });

        // Whitelist check — reject before completing auth
        if (whitelistEnabled && !whitelist.has(username.toLowerCase())) {
          postMsg({ type: "log", level: "warn", category: "transport", message: `${username} not on whitelist — disconnecting` });
          // Build a disconnect packet via WASM
          const reason = JSON.stringify({ text: "You are not whitelisted on this server." });
          const disconnectBytes = new Uint8Array(wasmModule.build_disconnect(reason));
          if (disconnectBytes.length > 0) {
            await streamWriter.write(disconnectBytes);
          }
          break;
        }

        try {
          const mojangResp = await fetch(
            `/api/mojang/session/minecraft/hasJoined?username=${encodeURIComponent(username)}&serverId=${encodeURIComponent(server_hash)}`
          );
          const mojangJson = await mojangResp.text();
          const loginBytes = new Uint8Array(wasmModule.complete_auth(mojangJson));

          if (loginBytes.length > 0) {
            postMsg({ type: "log", level: "info", category: "transport", message: `Sending Login Success (${loginBytes.length} bytes)` });
            await streamWriter.write(loginBytes);
          }
        } catch (err) {
          postMsg({ type: "log", level: "error", category: "transport", message: `Mojang auth failed: ${err}` });
        }
      } else if (response.length > 0) {
        await streamWriter.write(response);
      }

      // Check if WASM is awaiting chunks (initial or player moved to new chunk)
      if (wasmModule.get_awaiting_chunks()) {
        wasmModule.clear_awaiting_chunks();
        activeStreamWriter = streamWriter;
        requestChunks();
      }
    }
  } catch (err) {
    postMsg({ type: "log", level: "debug", category: "transport", message: `Stream ended: ${err}` });
  } finally {
    streamReader.releaseLock();
    streamWriter.releaseLock();
    activeStreamWriter = null;
  }
}

function enqueueChunkBatchStart(): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStreamWriter) return;
    const startBytes = new Uint8Array(wasmModule.chunk_batch_start());
    if (startBytes.length > 0) {
      try {
        await activeStreamWriter.write(startBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send batch start: ${err}` });
      }
    }
  });
}

function enqueueChunkData(cx: number, cz: number, blockStates: Uint16Array): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStreamWriter) return;
    const chunkBytes = new Uint8Array(wasmModule.build_chunk(cx, cz, blockStates));
    if (chunkBytes.length > 0) {
      try {
        await activeStreamWriter.write(chunkBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send chunk: ${err}` });
      }
    }
  });
}

function enqueueChunkBatchDone(count: number): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStreamWriter) return;
    // Initial spawn: play_finish (includes Sync Player Position teleport)
    // Ongoing: chunk_batch_end (just Chunk Batch Finished, no teleport)
    let finishBytes: Uint8Array;
    if (isInitialSpawn) {
      finishBytes = new Uint8Array(wasmModule.play_finish(count));
      isInitialSpawn = false;
    } else {
      finishBytes = new Uint8Array(wasmModule.chunk_batch_end(count));
    }
    if (finishBytes.length > 0) {
      try {
        await activeStreamWriter.write(finishBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send finish: ${err}` });
      }
    }
    postMsg({ type: "log", level: "info", category: "protocol", message: `Sent ${count} chunks + batch end to client` });

    // Batch complete — check if another chunk request came in while we were busy
    batchInFlight = false;
    if (pendingChunkRequest) {
      pendingChunkRequest = false;
      requestChunks();
    }
  });
}

function pushStats(): void {
  if (!wasmModule) return;
  try {
    const statsJson = wasmModule.get_stats() as string;
    const stats = JSON.parse(statsJson);
    postMsg({ type: "stats", stats });

    const logJson = wasmModule.get_packet_log() as string;
    const entries = JSON.parse(logJson);
    if (entries.length > 0) {
      postMsg({ type: "packet_log", entries });
    }
  } catch {
    // WASM not ready
  }
}

function handleStop(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  activeStreamWriter = null;
  controlWriter = null;
  if (transport) {
    transport.close();
    transport = null;
  }
  if (wasmModule) {
    wasmModule.reset_state();
  }
  postMsg({ type: "log", level: "info", category: "system", message: "Server stopped" });
  postMsg({ type: "status_change", status: "stopped" });
}

// Message handler
self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "start":
      (self as any).__CERT_HASH = msg.certHash;
      await handleStart(msg.wtUrl, msg.config, msg.subdomain);
      break;
    case "stop":
      handleStop();
      break;
    case "set_config":
      whitelistEnabled = msg.config.whitelist_enabled ?? false;
      whitelist = new Set((msg.config.whitelist ?? []).map((n: string) => n.toLowerCase()));
      viewDistance = msg.config.render_distance ?? 10;
      if (wasmModule) {
        wasmModule.set_server_config(JSON.stringify(msg.config));
      }
      break;
    case "queue_chat":
      if (wasmModule) {
        wasmModule.queue_chat(msg.message);
      }
      break;
    case "chunk_data":
      enqueueChunkData(msg.cx, msg.cz, msg.blockStates);
      break;
    case "chunk_batch_done":
      enqueueChunkBatchDone(msg.count);
      break;
    case "regenerate_chunks":
      if (wasmModule && activeStreamWriter) {
        sentChunks.clear();
        requestChunks();
      }
      break;
    case "set_public":
      if (controlWriter) {
        const payload = JSON.stringify({ public: msg.public });
        controlWriter.write(new TextEncoder().encode(payload)).catch(() => {});
        postMsg({ type: "log", level: "info", category: "transport", message: `Server visibility: ${msg.public ? "public" : "private"}` });
      }
      break;
  }
};
