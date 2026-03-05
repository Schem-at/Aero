/// Server Worker — runs WASM + WebTransport/WebSocket off the main thread.

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

// ---------------------------------------------------------------------------
// Transport abstraction — works over WebTransport or WebSocket
// ---------------------------------------------------------------------------

interface StreamHandle {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  close(): void;
}

interface TransportHandle {
  createControlStream(): Promise<StreamHandle>;
  acceptStream(): Promise<StreamHandle | null>;
  close(): void;
}

// --- WebTransport implementation ---

class WTTransport implements TransportHandle {
  private streamReader: ReadableStreamDefaultReader<WebTransportBidirectionalStream>;
  constructor(private wt: WebTransport) {
    this.streamReader = wt.incomingBidirectionalStreams.getReader();
  }
  async createControlStream(): Promise<StreamHandle> {
    const bidi = await this.wt.createBidirectionalStream();
    return new WTStream(bidi);
  }
  async acceptStream(): Promise<StreamHandle | null> {
    const { value, done } = await this.streamReader.read();
    if (done) return null;
    return new WTStream(value);
  }
  close(): void {
    this.streamReader.releaseLock();
    this.wt.close();
  }
}

class WTStream implements StreamHandle {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  constructor(bidi: WebTransportBidirectionalStream) {
    this.reader = bidi.readable.getReader();
    this.writer = bidi.writable.getWriter();
  }
  async read(): Promise<Uint8Array | null> {
    const { value, done } = await this.reader.read();
    if (done) return null;
    return value ?? null;
  }
  async write(data: Uint8Array): Promise<void> {
    await this.writer.write(data);
  }
  close(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
}

// --- WebSocket multiplexing implementation ---
// Protocol: [1 byte type][4 bytes stream_id BE][payload...]
// Types: 0x00=DATA, 0x01=STREAM_OPEN, 0x02=STREAM_CLOSE

const WS_DATA = 0x00;
const WS_STREAM_OPEN = 0x01;
const WS_STREAM_CLOSE = 0x02;

class WSTransport implements TransportHandle {
  private ws: WebSocket;
  private streams = new Map<number, WSStream>();
  private acceptQueue: ((stream: WSStream | null) => void)[] = [];
  private controlStream: WSStream;
  private closed = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.controlStream = new WSStream(0, this);
    this.streams.set(0, this.controlStream);

    ws.onmessage = (e: MessageEvent) => {
      const data = new Uint8Array(e.data as ArrayBuffer);
      if (data.length < 5) return;

      const type = data[0];
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const streamId = view.getUint32(1, false);
      const payload = data.slice(5);

      switch (type) {
        case WS_DATA:
          this.streams.get(streamId)?.pushData(payload);
          break;
        case WS_STREAM_OPEN: {
          const stream = new WSStream(streamId, this);
          this.streams.set(streamId, stream);
          const resolver = this.acceptQueue.shift();
          if (resolver) resolver(stream);
          break;
        }
        case WS_STREAM_CLOSE: {
          const stream = this.streams.get(streamId);
          if (stream) {
            stream.closeRemote();
            this.streams.delete(streamId);
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      this.closed = true;
      for (const resolver of this.acceptQueue) resolver(null);
      this.acceptQueue = [];
      for (const stream of this.streams.values()) stream.closeRemote();
    };
  }

  async createControlStream(): Promise<StreamHandle> {
    return this.controlStream;
  }

  async acceptStream(): Promise<StreamHandle | null> {
    if (this.closed) return null;
    return new Promise((resolve) => {
      this.acceptQueue.push(resolve);
    });
  }

  sendRaw(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }
}

class WSStream implements StreamHandle {
  private buffer: Uint8Array[] = [];
  private waiters: ((data: Uint8Array | null) => void)[] = [];
  private closed = false;

  constructor(private id: number, private transport: WSTransport) {}

  pushData(data: Uint8Array): void {
    if (this.closed) return;
    const copy = new Uint8Array(data);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(copy);
    } else {
      this.buffer.push(copy);
    }
  }

  closeRemote(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter(null);
    this.waiters = [];
  }

  async read(): Promise<Uint8Array | null> {
    if (this.buffer.length > 0) return this.buffer.shift()!;
    if (this.closed) return null;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async write(data: Uint8Array): Promise<void> {
    const msg = new Uint8Array(5 + data.length);
    msg[0] = WS_DATA;
    new DataView(msg.buffer).setUint32(1, this.id, false);
    msg.set(data, 5);
    this.transport.sendRaw(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const header = new Uint8Array(5);
    header[0] = WS_STREAM_CLOSE;
    new DataView(header.buffer).setUint32(1, this.id, false);
    this.transport.sendRaw(header);
  }
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let wasmModule: any = null;
let activeTransport: TransportHandle | null = null;
let controlStream: StreamHandle | null = null;
let activeStream: StreamHandle | null = null;
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
  if (batchInFlight) {
    pendingChunkRequest = true;
    return;
  }

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
    enqueueChunkBatchStart();
    enqueueChunkBatchDone(0);
  }
}

async function initWasm(): Promise<void> {
  if (wasmModule) return;
  const mod = await import("../../public/wasm/aero_server");
  await mod.default();
  wasmModule = mod;
}

// ---------------------------------------------------------------------------
// Transport connection helpers
// ---------------------------------------------------------------------------

async function connectWebTransport(wtUrl: string, certHash: string): Promise<TransportHandle> {
  const hashBytes = Uint8Array.from(atob(certHash), (c: string) => c.charCodeAt(0));
  const wt = new WebTransport(wtUrl, {
    serverCertificateHashes: [
      { algorithm: "sha-256", value: hashBytes.buffer },
    ],
  });
  await wt.ready;
  postMsg({ type: "log", level: "info", category: "transport", message: "WebTransport connected" });
  return new WTTransport(wt);
}

async function connectWebSocket(wsUrl: string): Promise<TransportHandle> {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket connection failed"));
  });
  postMsg({ type: "log", level: "info", category: "transport", message: "WebSocket connected" });
  return new WSTransport(ws);
}

// ---------------------------------------------------------------------------
// Main session logic
// ---------------------------------------------------------------------------

async function handleStart(wtUrl: string, wsUrl: string, config: WorkerServerConfig, subdomain: string): Promise<void> {
  try {
    postMsg({ type: "log", level: "info", category: "system", message: "Starting WASM server module..." });

    await initWasm();
    wasmModule.set_server_config(JSON.stringify(config));
    whitelistEnabled = config.whitelist_enabled ?? false;
    whitelist = new Set((config.whitelist ?? []).map((n: string) => n.toLowerCase()));
    viewDistance = config.render_distance ?? 10;

    postMsg({ type: "log", level: "info", category: "system", message: "WASM initialized, connecting transport..." });

    // Try WebTransport first, fall back to WebSocket
    const certHash = (self as any).__CERT_HASH;
    if (typeof WebTransport !== "undefined" && certHash) {
      try {
        activeTransport = await connectWebTransport(wtUrl, certHash);
      } catch (err) {
        postMsg({ type: "log", level: "warn", category: "transport", message: `WebTransport failed, falling back to WebSocket: ${err}` });
        activeTransport = await connectWebSocket(wsUrl);
      }
    } else {
      postMsg({ type: "log", level: "info", category: "transport", message: "WebTransport not available, using WebSocket fallback" });
      activeTransport = await connectWebSocket(wsUrl);
    }

    // Register room
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
  if (!activeTransport) return;
  const stream = await activeTransport.createControlStream();

  const reg: Record<string, unknown> = { room };
  if (isPublic) reg.public = true;
  if (motd) reg.motd = motd;
  if (favicon) reg.favicon = favicon;
  await stream.write(new TextEncoder().encode(JSON.stringify(reg)));
  postMsg({ type: "log", level: "info", category: "transport", message: `Requesting room: ${room}` });

  const value = await stream.read();
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

  // Keep control stream for sending updates (public toggle, motd changes)
  controlStream = stream;
}

async function acceptStreams(): Promise<void> {
  if (!activeTransport) return;
  try {
    while (true) {
      const stream = await activeTransport.acceptStream();
      if (!stream) break;
      handleStream(stream);
    }
  } catch (err) {
    if (activeTransport) {
      postMsg({ type: "log", level: "warn", category: "transport", message: `Stream accept ended: ${err}` });
    }
  }
}

async function handleStream(stream: StreamHandle): Promise<void> {
  postMsg({ type: "log", level: "info", category: "transport", message: "New client stream accepted" });

  // Reset WASM state for new connection (no mutex needed — worker is single-threaded)
  wasmModule.reset_state();
  sentChunks.clear();
  chunkQueue = Promise.resolve();
  isInitialSpawn = true;
  batchInFlight = false;
  pendingChunkRequest = false;
  activeStream = stream;

  try {
    while (true) {
      const value = await stream.read();
      if (!value) break;

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

        // Whitelist check
        if (whitelistEnabled && !whitelist.has(username.toLowerCase())) {
          postMsg({ type: "log", level: "warn", category: "transport", message: `${username} not on whitelist — disconnecting` });
          const reason = JSON.stringify({ text: "You are not whitelisted on this server." });
          const disconnectBytes = new Uint8Array(wasmModule.build_disconnect(reason));
          if (disconnectBytes.length > 0) {
            await stream.write(disconnectBytes);
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
            await stream.write(loginBytes);
          }
        } catch (err) {
          postMsg({ type: "log", level: "error", category: "transport", message: `Mojang auth failed: ${err}` });
        }
      } else if (response.length > 0) {
        await stream.write(response);
      }

      // Check if WASM is awaiting chunks
      if (wasmModule.get_awaiting_chunks()) {
        wasmModule.clear_awaiting_chunks();
        requestChunks();
      }
    }
  } catch (err) {
    postMsg({ type: "log", level: "debug", category: "transport", message: `Stream ended: ${err}` });
  } finally {
    stream.close();
    activeStream = null;
  }
}

function enqueueChunkBatchStart(): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStream) return;
    const startBytes = new Uint8Array(wasmModule.chunk_batch_start());
    if (startBytes.length > 0) {
      try {
        await activeStream.write(startBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send batch start: ${err}` });
      }
    }
  });
}

function enqueueChunkData(cx: number, cz: number, blockStates: Uint16Array): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStream) return;
    const chunkBytes = new Uint8Array(wasmModule.build_chunk(cx, cz, blockStates));
    if (chunkBytes.length > 0) {
      try {
        await activeStream.write(chunkBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send chunk: ${err}` });
      }
    }
  });
}

function enqueueChunkBatchDone(count: number): void {
  chunkQueue = chunkQueue.then(async () => {
    if (!wasmModule || !activeStream) return;
    let finishBytes: Uint8Array;
    if (isInitialSpawn) {
      finishBytes = new Uint8Array(wasmModule.play_finish(count));
      isInitialSpawn = false;
    } else {
      finishBytes = new Uint8Array(wasmModule.chunk_batch_end(count));
    }
    if (finishBytes.length > 0) {
      try {
        await activeStream.write(finishBytes);
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "transport", message: `Failed to send finish: ${err}` });
      }
    }
    postMsg({ type: "log", level: "info", category: "protocol", message: `Sent ${count} chunks + batch end to client` });

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
  activeStream = null;
  controlStream = null;
  if (activeTransport) {
    activeTransport.close();
    activeTransport = null;
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
      await handleStart(msg.wtUrl, msg.wsUrl, msg.config, msg.subdomain);
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
      if (wasmModule && activeStream) {
        sentChunks.clear();
        requestChunks();
      }
      break;
    case "set_public":
      if (controlStream) {
        const payload = JSON.stringify({ public: msg.public });
        controlStream.write(new TextEncoder().encode(payload)).catch(() => {});
        postMsg({ type: "log", level: "info", category: "transport", message: `Server visibility: ${msg.public ? "public" : "private"}` });
      }
      break;
  }
};
