/// Server Worker — runs WASM + WebTransport/WebSocket off the main thread.
/// Supports multiple concurrent player connections.

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

// Catch unhandled promise rejections so they surface as logs
self.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  postMsg({ type: "log", level: "error", category: "system", message: `Unhandled rejection: ${msg}` });
});

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
// Per-player session state
// ---------------------------------------------------------------------------

interface ClientSession {
  connectionId: number;  // WASM connection pool ID
  entityId: number;      // Minecraft entity ID
  stream: StreamHandle;
  sentChunks: Set<string>;
  chunkQueue: Promise<void>;
  viewDistance: number;
  isInitialSpawn: boolean;
  batchInFlight: boolean;
  pendingChunkRequest: boolean;
  lastChunkCenterX: number;
  lastChunkCenterZ: number;
  // Player data (populated after auth)
  username: string;
  uuid: string;
  propertiesJson: string;
  // Position tracking for multiplayer
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  // True once the player has fully entered Play state
  inPlay: boolean;
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let wasmModule: any = null;
let activeTransport: TransportHandle | null = null;
let controlStream: StreamHandle | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;

// All active player sessions, keyed by connectionId
const sessions = new Map<number, ClientSession>();

// Whitelist state
let whitelistEnabled = false;
let whitelist: Set<string> = new Set();
let globalViewDistance = 10;

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

// ---------------------------------------------------------------------------
// Multiplayer helpers
// ---------------------------------------------------------------------------

/** Send a packet to all sessions except the given one. */
function broadcastExcept(excludeId: number, buildFn: (targetId: number) => Uint8Array): void {
  for (const [, session] of sessions) {
    if (session.connectionId === excludeId) continue;
    if (!session.inPlay) continue; // Not yet in Play state
    try {
      const bytes = buildFn(session.connectionId);
      if (bytes.length > 0) {
        session.stream.write(bytes).catch(() => {});
      }
    } catch {}
  }
}

/** Notify all existing players about a new player, and the new player about all existing ones. */
function onPlayerJoined(newSession: ClientSession): void {
  // Tell existing players about the new player
  broadcastExcept(newSession.connectionId, (targetId) => {
    // Add to tab list
    const infoBytes = new Uint8Array(wasmModule.build_player_info_add(
      targetId, newSession.uuid, newSession.username, newSession.propertiesJson
    ));
    const spawnBytes = new Uint8Array(wasmModule.build_spawn_entity(
      targetId, newSession.entityId, newSession.uuid,
      newSession.x, newSession.y, newSession.z, newSession.yaw, newSession.pitch
    ));
    // Combine both packets
    const combined = new Uint8Array(infoBytes.length + spawnBytes.length);
    combined.set(infoBytes, 0);
    combined.set(spawnBytes, infoBytes.length);
    return combined;
  });

  // Tell the new player about all existing players
  for (const [, other] of sessions) {
    if (other.connectionId === newSession.connectionId) continue;
    if (!other.username) continue;
    try {
      const infoBytes = new Uint8Array(wasmModule.build_player_info_add(
        newSession.connectionId, other.uuid, other.username, other.propertiesJson
      ));
      if (infoBytes.length > 0) {
        newSession.stream.write(infoBytes).catch(() => {});
      }
      const spawnBytes = new Uint8Array(wasmModule.build_spawn_entity(
        newSession.connectionId, other.entityId, other.uuid,
        other.x, other.y, other.z, other.yaw, other.pitch
      ));
      if (spawnBytes.length > 0) {
        newSession.stream.write(spawnBytes).catch(() => {});
      }
    } catch {}
  }
}

/** Notify all players that a player disconnected. */
function onPlayerLeft(session: ClientSession): void {
  const entityIdsJson = JSON.stringify([session.entityId]);
  broadcastExcept(session.connectionId, (targetId) => {
    const removeBytes = new Uint8Array(wasmModule.build_remove_entities(targetId, entityIdsJson));
    const infoRemoveBytes = new Uint8Array(wasmModule.build_player_info_remove(targetId, session.uuid));
    const combined = new Uint8Array(removeBytes.length + infoRemoveBytes.length);
    combined.set(removeBytes, 0);
    combined.set(infoRemoveBytes, removeBytes.length);
    return combined;
  });
}

/** Broadcast position update from one player to all others. */
function broadcastPosition(session: ClientSession): void {
  broadcastExcept(session.connectionId, (targetId) => {
    const teleportBytes = new Uint8Array(wasmModule.build_entity_teleport(
      targetId, session.entityId,
      session.x, session.y, session.z, session.yaw, session.pitch, false
    ));
    const headBytes = new Uint8Array(wasmModule.build_head_rotation(
      targetId, session.entityId, session.yaw
    ));
    const combined = new Uint8Array(teleportBytes.length + headBytes.length);
    combined.set(teleportBytes, 0);
    combined.set(headBytes, teleportBytes.length);
    return combined;
  });
}

/** Broadcast a chat message to all players. */
function broadcastChatMessage(message: string): void {
  for (const [, session] of sessions) {
    if (!session.inPlay) continue;
    try {
      const bytes = new Uint8Array(wasmModule.build_system_chat(session.connectionId, message));
      if (bytes.length > 0) {
        session.stream.write(bytes).catch(() => {});
      }
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Per-session chunk management
// ---------------------------------------------------------------------------

function requestChunksForSession(session: ClientSession): void {
  if (session.batchInFlight) {
    session.pendingChunkRequest = true;
    return;
  }

  const centerStr = wasmModule.get_pending_chunk_center(session.connectionId) as string;
  let centerX = session.lastChunkCenterX, centerZ = session.lastChunkCenterZ;
  if (centerStr) {
    const [cx, cz] = centerStr.split(",").map(Number);
    centerX = cx;
    centerZ = cz;
    wasmModule.clear_pending_chunk_center(session.connectionId);
  }
  session.lastChunkCenterX = centerX;
  session.lastChunkCenterZ = centerZ;

  const needed: { cx: number; cz: number }[] = [];
  const nowVisible = new Set<string>();

  for (let dx = -session.viewDistance; dx <= session.viewDistance; dx++) {
    for (let dz = -session.viewDistance; dz <= session.viewDistance; dz++) {
      const cx = centerX + dx;
      const cz = centerZ + dz;
      const key = chunkKey(cx, cz);
      nowVisible.add(key);
      if (!session.sentChunks.has(key)) {
        needed.push({ cx, cz });
        session.sentChunks.add(key);
      }
    }
  }

  for (const key of session.sentChunks) {
    if (!nowVisible.has(key)) {
      session.sentChunks.delete(key);
    }
  }

  session.batchInFlight = true;

  if (needed.length > 0) {
    enqueueChunkBatchStart(session);
    postMsg({ type: "chunks_needed", playerId: session.connectionId, chunks: needed });
  } else {
    enqueueChunkBatchStart(session);
    enqueueChunkBatchDone(session, 0);
  }
}

function enqueueChunkBatchStart(session: ClientSession): void {
  session.chunkQueue = session.chunkQueue.then(async () => {
    if (!wasmModule) return;
    const startBytes = new Uint8Array(wasmModule.chunk_batch_start(session.connectionId));
    if (startBytes.length > 0) {
      try { await session.stream.write(startBytes); } catch {}
    }
  });
}

function enqueueChunkData(session: ClientSession, cx: number, cz: number, blockStates: Uint16Array): void {
  session.chunkQueue = session.chunkQueue.then(async () => {
    if (!wasmModule) return;
    const chunkBytes = new Uint8Array(wasmModule.build_chunk(session.connectionId, cx, cz, blockStates));
    if (chunkBytes.length > 0) {
      try { await session.stream.write(chunkBytes); } catch {}
    }
  });
}

function enqueueChunkBatchDone(session: ClientSession, count: number): void {
  session.chunkQueue = session.chunkQueue.then(async () => {
    if (!wasmModule) return;
    let finishBytes: Uint8Array;
    if (session.isInitialSpawn) {
      finishBytes = new Uint8Array(wasmModule.play_finish(session.connectionId, count));
      session.isInitialSpawn = false;
    } else {
      finishBytes = new Uint8Array(wasmModule.chunk_batch_end(session.connectionId, count));
    }
    if (finishBytes.length > 0) {
      try { await session.stream.write(finishBytes); } catch {}
    }
    postMsg({ type: "log", level: "info", category: "protocol", message: `[${session.username || "?"}] Sent ${count} chunks + batch end` });

    session.batchInFlight = false;
    if (session.pendingChunkRequest) {
      session.pendingChunkRequest = false;
      requestChunksForSession(session);
    }
  });
}

// ---------------------------------------------------------------------------
// WASM init
// ---------------------------------------------------------------------------

async function initWasm(): Promise<void> {
  if (wasmModule) return;
  const mod = await import("../../public/wasm/aero_server");
  // Pass explicit URL to avoid import.meta.url issues in bundled workers
  // and add cache-buster to prevent stale .wasm binary from browser cache
  await mod.default(new URL(`/wasm/aero_server_bg.wasm?v=${Date.now()}`, self.location.origin));
  if (typeof mod.create_connection !== "function") {
    throw new Error(`WASM module missing create_connection. Available exports: ${Object.keys(mod).join(", ")}`);
  }
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
    globalViewDistance = config.render_distance ?? 10;

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

    // Accept incoming streams (concurrent)
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

  controlStream = stream;
}

async function acceptStreams(): Promise<void> {
  if (!activeTransport) return;
  try {
    while (true) {
      const stream = await activeTransport.acceptStream();
      if (!stream) break;
      // Spawn concurrent handler — don't await!
      handleStream(stream).catch((err) => {
        postMsg({ type: "log", level: "debug", category: "transport", message: `Stream handler error: ${err}` });
      });
    }
  } catch (err) {
    if (activeTransport) {
      postMsg({ type: "log", level: "warn", category: "transport", message: `Stream accept ended: ${err}` });
    }
  }
}

async function handleStream(stream: StreamHandle): Promise<void> {
  // Create a new WASM connection for this player
  const connectionId = wasmModule.create_connection() as number;
  const entityId = wasmModule.get_entity_id(connectionId) as number;

  const session: ClientSession = {
    connectionId,
    entityId,
    stream,
    sentChunks: new Set(),
    chunkQueue: Promise.resolve(),
    viewDistance: globalViewDistance,
    isInitialSpawn: true,
    batchInFlight: false,
    pendingChunkRequest: false,
    lastChunkCenterX: 0,
    lastChunkCenterZ: 0,
    username: "",
    uuid: "",
    propertiesJson: "[]",
    x: 8, y: 66, z: 8,
    yaw: 0, pitch: 0,
    inPlay: false,
  };

  sessions.set(connectionId, session);
  postMsg({ type: "log", level: "info", category: "transport", message: `New client stream accepted (connection ${connectionId})` });

  let playerJoined = false;

  try {
    while (true) {
      const value = await stream.read();
      if (!value) break;

      // Process packet through WASM
      const response = new Uint8Array(wasmModule.handle_packet(connectionId, value));

      // Check for pending Mojang auth
      const pendingStr = wasmModule.get_pending_auth(connectionId) as string;
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
          const disconnectBytes = new Uint8Array(wasmModule.build_disconnect(connectionId, reason));
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
          const loginBytes = new Uint8Array(wasmModule.complete_auth(connectionId, mojangJson));

          if (loginBytes.length > 0) {
            postMsg({ type: "log", level: "info", category: "transport", message: `Sending Login Success (${loginBytes.length} bytes)` });
            await stream.write(loginBytes);
          }

          // Store player data from login
          const loginDataStr = wasmModule.get_login_data(connectionId) as string;
          if (loginDataStr) {
            try {
              const ld = JSON.parse(loginDataStr);
              session.username = ld.username || "";
              session.uuid = ld.uuid || "";
              session.propertiesJson = JSON.stringify(
                (ld.properties || []).map((p: [string, string, string | null]) => [p[0], p[1], p[2]])
              );
            } catch {}
          }
        } catch (err) {
          postMsg({ type: "log", level: "error", category: "transport", message: `Mojang auth failed: ${err}` });
        }
      } else if (response.length > 0) {
        await stream.write(response);
      }

      // Check if WASM is awaiting chunks (entered Play state)
      if (wasmModule.get_awaiting_chunks(connectionId)) {
        wasmModule.clear_awaiting_chunks(connectionId);

        // Player has entered play state — notify other players
        if (!playerJoined && session.username) {
          playerJoined = true;
          session.inPlay = true;
          postMsg({ type: "log", level: "info", category: "system",
            message: `${session.username} joined the server (entity ${entityId})` });
          onPlayerJoined(session);
        }

        requestChunksForSession(session);
      }

      // Check for position/rotation updates from WASM (dirty flag)
      if (playerJoined) {
        const posStr = wasmModule.get_player_position(connectionId) as string;
        if (posStr) {
          const pos = JSON.parse(posStr);
          session.x = pos.x;
          session.y = pos.y;
          session.z = pos.z;
          session.yaw = pos.yaw;
          session.pitch = pos.pitch;
          broadcastPosition(session);
        }
      }
    }
  } catch (err) {
    postMsg({ type: "log", level: "debug", category: "transport", message: `Stream ended (${session.username || connectionId}): ${err}` });
  } finally {
    if (playerJoined) {
      postMsg({ type: "log", level: "info", category: "system",
        message: `${session.username} left the server` });
      onPlayerLeft(session);
    }
    stream.close();
    sessions.delete(connectionId);
    wasmModule.remove_connection(connectionId);
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function pushStats(): void {
  if (!wasmModule) return;
  try {
    const statsJson = wasmModule.get_aggregate_stats() as string;
    const stats = JSON.parse(statsJson);
    postMsg({ type: "stats", stats });

    const logJson = wasmModule.get_all_packet_logs() as string;
    const entries = JSON.parse(logJson);
    if (entries.length > 0) {
      postMsg({ type: "packet_log", entries });
    }
  } catch {
    // WASM not ready
  }
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

function handleStop(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  // Close all sessions
  for (const [id, session] of sessions) {
    session.stream.close();
    wasmModule?.remove_connection(id);
  }
  sessions.clear();
  controlStream = null;
  if (activeTransport) {
    activeTransport.close();
    activeTransport = null;
  }
  postMsg({ type: "log", level: "info", category: "system", message: "Server stopped" });
  postMsg({ type: "status_change", status: "stopped" });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

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
      globalViewDistance = msg.config.render_distance ?? 10;
      if (wasmModule) {
        wasmModule.set_server_config(JSON.stringify(msg.config));
      }
      // Update view distance for all sessions
      for (const session of sessions.values()) {
        session.viewDistance = globalViewDistance;
      }
      break;
    case "queue_chat":
      if (wasmModule) {
        // Broadcast chat to all players
        broadcastChatMessage(msg.message);
      }
      break;
    case "chunk_data": {
      const session = sessions.get(msg.playerId);
      if (session) {
        enqueueChunkData(session, msg.cx, msg.cz, msg.blockStates);
      }
      break;
    }
    case "chunk_batch_done": {
      const session = sessions.get(msg.playerId);
      if (session) {
        enqueueChunkBatchDone(session, msg.count);
      }
      break;
    }
    case "regenerate_chunks":
      // Regenerate for all connected players
      for (const session of sessions.values()) {
        session.sentChunks.clear();
        requestChunksForSession(session);
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
