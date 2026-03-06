/// Server Worker — runs WASM + WebTransport/WebSocket off the main thread.
/// Supports multiple concurrent player connections.

import type { MainToWorkerMessage, WorkerToMainMessage, WorkerServerConfig } from "@/types/worker-messages";
import { ITEM_TO_BLOCK } from "@/lib/item-block-map";
import { RegionStore } from "@/lib/opfs-region-store";

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
  // True when the player is dead (waiting for respawn)
  isDead: boolean;
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

// Pre-serialized item→block mapping for WASM connections
const itemBlockMapJson = JSON.stringify(ITEM_TO_BLOCK);

// ─── World persistence state ────────────────────────────────────────────────
let regionStore: RegionStore | null = null;
const loadedChunks = new Map<string, Uint16Array>(); // chunkKey → block states
const dirtyChunks = new Set<string>();                // chunks needing save
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

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
  const newSkinParts = wasmModule.get_skin_parts(newSession.connectionId) as number;

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
    // Send skin metadata so layers render correctly
    const metaBytes = new Uint8Array(wasmModule.build_entity_metadata(
      targetId, newSession.entityId, newSkinParts
    ));
    const combined = new Uint8Array(infoBytes.length + spawnBytes.length + metaBytes.length);
    combined.set(infoBytes, 0);
    combined.set(spawnBytes, infoBytes.length);
    combined.set(metaBytes, infoBytes.length + spawnBytes.length);
    return combined;
  });

  // Send the new player their own skin metadata (for 3rd person / inventory rendering)
  try {
    const selfMeta = new Uint8Array(wasmModule.build_entity_metadata(
      newSession.connectionId, newSession.entityId, newSkinParts
    ));
    if (selfMeta.length > 0) {
      newSession.stream.write(selfMeta).catch(() => {});
    }
  } catch {}

  // Tell the new player about all existing players
  for (const [, other] of sessions) {
    if (other.connectionId === newSession.connectionId) continue;
    if (!other.username) continue;
    try {
      const infoBytes = new Uint8Array(wasmModule.build_player_info_add(
        newSession.connectionId, other.uuid, other.username, other.propertiesJson
      ));
      const spawnBytes = new Uint8Array(wasmModule.build_spawn_entity(
        newSession.connectionId, other.entityId, other.uuid,
        other.x, other.y, other.z, other.yaw, other.pitch
      ));
      // Send existing player's skin metadata
      const otherSkinParts = wasmModule.get_skin_parts(other.connectionId) as number;
      const metaBytes = new Uint8Array(wasmModule.build_entity_metadata(
        newSession.connectionId, other.entityId, otherSkinParts
      ));
      const combined = new Uint8Array(infoBytes.length + spawnBytes.length + metaBytes.length);
      combined.set(infoBytes, 0);
      combined.set(spawnBytes, infoBytes.length);
      combined.set(metaBytes, infoBytes.length + spawnBytes.length);
      if (combined.length > 0) {
        newSession.stream.write(combined).catch(() => {});
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
    const syncBytes = new Uint8Array(wasmModule.build_entity_position_sync(
      targetId, session.entityId,
      session.x, session.y, session.z, session.yaw, session.pitch, true
    ));
    const headBytes = new Uint8Array(wasmModule.build_head_rotation(
      targetId, session.entityId, session.yaw
    ));
    const combined = new Uint8Array(syncBytes.length + headBytes.length);
    combined.set(syncBytes, 0);
    combined.set(headBytes, syncBytes.length);
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
    // Check OPFS/in-memory cache before requesting from main thread
    loadCachedChunks(session, needed);
  } else {
    enqueueChunkBatchStart(session);
    enqueueChunkBatchDone(session, 0);
  }
}

/** Try loading chunks from in-memory cache or OPFS, fall back to main thread for misses. */
async function loadCachedChunks(session: ClientSession, needed: { cx: number; cz: number }[]): Promise<void> {
  const misses: { cx: number; cz: number }[] = [];
  const hits: { cx: number; cz: number; blockStates: Uint16Array }[] = [];

  for (const { cx, cz } of needed) {
    const key = chunkKey(cx, cz);

    // Check in-memory cache first
    if (loadedChunks.has(key)) {
      hits.push({ cx, cz, blockStates: loadedChunks.get(key)! });
      continue;
    }

    // Check OPFS
    if (regionStore && wasmModule) {
      try {
        const blockStates = await regionStore.readChunk(cx, cz, wasmModule);
        if (blockStates) {
          loadedChunks.set(key, blockStates);
          hits.push({ cx, cz, blockStates });
          continue;
        }
      } catch {}
    }

    misses.push({ cx, cz });
  }

  enqueueChunkBatchStart(session);

  // Send cached hits immediately
  for (const { cx, cz, blockStates } of hits) {
    enqueueChunkData(session, cx, cz, blockStates);
  }

  if (misses.length > 0) {
    // Request remaining from main thread generator
    postMsg({ type: "chunks_needed", playerId: session.connectionId, chunks: misses });
  } else {
    enqueueChunkBatchDone(session, hits.length);
  }
}

function enqueueChunkBatchStart(session: ClientSession): void {
  session.chunkQueue = session.chunkQueue.then(async () => {
    if (!wasmModule) return;
    const startBytes = new Uint8Array(wasmModule.chunk_batch_start(session.connectionId));
    if (startBytes.length > 0) {
      try { await session.stream.write(startBytes); } catch {}
    }
  }).catch(() => {});
}

function enqueueChunkData(session: ClientSession, cx: number, cz: number, blockStates: Uint16Array): void {
  session.chunkQueue = session.chunkQueue.then(async () => {
    if (!wasmModule) return;
    const chunkBytes = new Uint8Array(wasmModule.build_chunk(session.connectionId, cx, cz, blockStates));
    if (chunkBytes.length > 0) {
      try { await session.stream.write(chunkBytes); } catch {}
    }
  }).catch(() => {});
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
  }).catch(() => {}).finally(() => {
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
  wasmModule.set_item_block_map(connectionId, itemBlockMapJson);

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
    isDead: false,
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

      // Check for /tp <player> deferred from WASM
      if (playerJoined) {
        const tpTarget = wasmModule.get_pending_tp(connectionId) as string;
        if (tpTarget) {
          wasmModule.clear_pending_tp(connectionId);
          // Find target player by username (case-insensitive)
          const targetLower = tpTarget.toLowerCase();
          let found = false;
          for (const [, other] of sessions) {
            if (other.connectionId === connectionId) continue;
            if (!other.inPlay) continue;
            if (other.username.toLowerCase() === targetLower) {
              const msg = `Teleported to ${other.username}`;
              const tpBytes = new Uint8Array(
                wasmModule.teleport_player(connectionId, other.x, other.y, other.z, msg)
              );
              if (tpBytes.length > 0) {
                await stream.write(tpBytes);
              }
              // teleport_player sets awaiting_chunks, so request chunks
              if (wasmModule.get_awaiting_chunks(connectionId)) {
                wasmModule.clear_awaiting_chunks(connectionId);
                requestChunksForSession(session);
              }
              found = true;
              break;
            }
          }
          if (!found) {
            const errMsg = `Player "${tpTarget}" not found`;
            const chatBytes = new Uint8Array(wasmModule.build_system_chat(connectionId, errMsg));
            if (chatBytes.length > 0) {
              await stream.write(chatBytes);
            }
          }
        }
      }

      // Check for in-game chat broadcast (relay to other players)
      if (playerJoined) {
        const chatMsg = wasmModule.get_pending_chat_broadcast(connectionId) as string;
        if (chatMsg) {
          wasmModule.clear_pending_chat_broadcast(connectionId);
          // Send to all OTHER players
          for (const [, other] of sessions) {
            if (other.connectionId === connectionId) continue;
            if (!other.inPlay) continue;
            try {
              const bytes = new Uint8Array(wasmModule.build_system_chat(other.connectionId, chatMsg));
              if (bytes.length > 0) {
                other.stream.write(bytes).catch(() => {});
              }
            } catch {}
          }
        }
      }

      // Check for block events (break/place) and broadcast to ALL players (including self)
      if (playerJoined) {
        const blockEventsStr = wasmModule.get_pending_block_events(connectionId) as string;
        if (blockEventsStr) {
          const events = JSON.parse(blockEventsStr) as { x: number; y: number; z: number; block_state: number }[];
          for (const evt of events) {
            // Update in-memory chunk data for persistence
            applyBlockEvent(evt.x, evt.y, evt.z, evt.block_state);

            for (const [, other] of sessions) {
              if (!other.inPlay) continue;
              try {
                const bytes = new Uint8Array(
                  wasmModule.build_block_update(other.connectionId, evt.x, evt.y, evt.z, evt.block_state)
                );
                if (bytes.length > 0) {
                  other.stream.write(bytes).catch(() => {});
                }
              } catch {}
            }
          }
        }
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

      // Check for skin parts changes and broadcast entity metadata (including self)
      if (playerJoined) {
        if (wasmModule.get_skin_parts_dirty(connectionId)) {
          wasmModule.clear_skin_parts_dirty(connectionId);
          const skinParts = wasmModule.get_skin_parts(connectionId) as number;
          // Send to self
          try {
            const selfMeta = new Uint8Array(wasmModule.build_entity_metadata(connectionId, session.entityId, skinParts));
            if (selfMeta.length > 0) session.stream.write(selfMeta).catch(() => {});
          } catch {}
          // Send to others
          broadcastExcept(connectionId, (targetId) => {
            return new Uint8Array(wasmModule.build_entity_metadata(targetId, session.entityId, skinParts));
          });
        }
      }

      // Check for entity flags changes (sneaking/sprinting/elytra) and broadcast
      if (playerJoined) {
        if (wasmModule.get_entity_flags_dirty(connectionId)) {
          wasmModule.clear_entity_flags_dirty(connectionId);
          const flags = wasmModule.get_entity_flags(connectionId) as number;
          const pose = wasmModule.get_entity_pose(connectionId) as number;
          // Send to all players (including self for 3rd person)
          for (const [, other] of sessions) {
            if (!other.inPlay) continue;
            try {
              const bytes = new Uint8Array(wasmModule.build_entity_flags(other.connectionId, session.entityId, flags, pose));
              if (bytes.length > 0) other.stream.write(bytes).catch(() => {});
            } catch {}
          }
        }
      }

      // Check for swing arm animation and broadcast to others
      if (playerJoined) {
        if (wasmModule.get_pending_swing(connectionId)) {
          wasmModule.clear_pending_swing(connectionId);
          broadcastExcept(connectionId, (targetId) => {
            return new Uint8Array(wasmModule.build_entity_animation(targetId, session.entityId, 0)); // 0 = SwingMainArm
          });
        }
      }

      // Check for held item changes and broadcast equipment to other players
      if (playerJoined) {
        if (wasmModule.get_held_item_dirty(connectionId)) {
          wasmModule.clear_held_item_dirty(connectionId);
          const itemId = wasmModule.get_held_item_id(connectionId) as number;
          broadcastExcept(connectionId, (targetId) => {
            return new Uint8Array(wasmModule.build_entity_equipment(targetId, session.entityId, itemId));
          });
        }
      }

      // Check for fall damage
      if (playerJoined) {
        const fallDmg = wasmModule.get_pending_fall_damage(connectionId) as number;
        if (fallDmg > 0) {
          wasmModule.clear_pending_fall_damage(connectionId);
          const currentHealth = wasmModule.get_health(connectionId) as number;
          const newHealth = Math.max(0, currentHealth - fallDmg);
          wasmModule.set_health(connectionId, newHealth);

          // Send health update to the player
          try {
            const healthBytes = new Uint8Array(wasmModule.build_set_health(connectionId, newHealth));
            if (healthBytes.length > 0) session.stream.write(healthBytes).catch(() => {});
          } catch {}

          // Send hurt animation to all players
          for (const [, other] of sessions) {
            if (!other.inPlay) continue;
            try {
              const hurtBytes = new Uint8Array(wasmModule.build_damage_packets(
                other.connectionId, session.entityId, session.entityId,
                0, 0, 0, 0 // no knockback for fall damage
              ));
              if (hurtBytes.length > 0) other.stream.write(hurtBytes).catch(() => {});
            } catch {}
          }

          // Handle death from fall damage
          if (newHealth <= 0 && !session.isDead) {
            session.isDead = true;
            try {
              const deathBytes = new Uint8Array(wasmModule.build_combat_death(
                connectionId, session.entityId, ""
              ));
              if (deathBytes.length > 0) session.stream.write(deathBytes).catch(() => {});
            } catch {}
          }
        }
      }

      // Check for pending attacks (PvP)
      if (playerJoined) {
        const attacksStr = wasmModule.get_pending_attacks(connectionId) as string;
        if (attacksStr) {
          const targetEntityIds = JSON.parse(attacksStr) as number[];
          for (const targetEntityId of targetEntityIds) {
            // Find the victim session
            let victim: ClientSession | undefined;
            for (const [, s] of sessions) {
              if (s.entityId === targetEntityId && s.inPlay) {
                victim = s;
                break;
              }
            }
            if (!victim) continue;

            // Creative mode players are invulnerable
            const victimGamemode = wasmModule.get_gamemode(victim.connectionId) as number;
            if (victimGamemode === 1) continue; // Creative = invulnerable

            // Calculate knockback direction from attacker to victim
            const dx = victim.x - session.x;
            const dz = victim.z - session.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const knockbackStrength = 0.4;
            const kx = dist > 0 ? (dx / dist) * knockbackStrength : 0;
            const ky = 0.36;
            const kz = dist > 0 ? (dz / dist) * knockbackStrength : 0;

            // Deal 1 damage
            const currentHealth = wasmModule.get_health(victim.connectionId) as number;
            const newHealth = Math.max(0, currentHealth - 1);
            wasmModule.set_health(victim.connectionId, newHealth);

            // Calculate hit yaw (direction damage came from)
            const hitYaw = Math.atan2(dz, dx) * (180 / Math.PI) - 90;

            // Send damage packets to ALL players (hurt animation + damage event + velocity)
            for (const [, other] of sessions) {
              if (!other.inPlay) continue;
              try {
                const bytes = new Uint8Array(wasmModule.build_damage_packets(
                  other.connectionId, victim.entityId, session.entityId,
                  hitYaw, kx, ky, kz
                ));
                if (bytes.length > 0) other.stream.write(bytes).catch(() => {});
              } catch {}
            }

            // Send health update to victim
            try {
              const healthBytes = new Uint8Array(wasmModule.build_set_health(victim.connectionId, newHealth));
              if (healthBytes.length > 0) victim.stream.write(healthBytes).catch(() => {});
            } catch {}

            // Handle death
            if (newHealth <= 0 && !victim.isDead) {
              victim.isDead = true;
              // Send Combat Death to the victim
              try {
                const deathBytes = new Uint8Array(wasmModule.build_combat_death(
                  victim.connectionId, victim.entityId, session.username || "a player"
                ));
                if (deathBytes.length > 0) victim.stream.write(deathBytes).catch(() => {});
              } catch {}
            }
          }
        }
      }

      // Check for pending respawn
      if (playerJoined && wasmModule.get_pending_respawn(connectionId)) {
        wasmModule.clear_pending_respawn(connectionId);
        const gamemode = wasmModule.get_gamemode(connectionId) as number;

        // Send respawn packets (dimension respawn + health reset + wait for chunks event)
        try {
          const respawnBytes = new Uint8Array(wasmModule.build_respawn(connectionId, gamemode));
          if (respawnBytes.length > 0) session.stream.write(respawnBytes).catch(() => {});
        } catch {}

        // Reset death state (entity_flags/elytra cleared in WASM build_respawn)
        session.isDead = false;

        // Reset position to spawn and trigger chunk re-send
        session.x = 8;
        session.y = 66;
        session.z = 8;
        session.sentChunks.clear();
        session.isInitialSpawn = true;
        session.batchInFlight = false;
        session.pendingChunkRequest = false;
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
// World persistence helpers
// ---------------------------------------------------------------------------

/** Update an in-memory chunk with a block change and mark it dirty. */
function applyBlockEvent(x: number, y: number, z: number, blockState: number): void {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const key = chunkKey(cx, cz);
  const chunk = loadedChunks.get(key);
  if (!chunk) return;

  // Convert world coords to index within the 98304-entry array
  const localX = ((x % 16) + 16) % 16;
  const localZ = ((z % 16) + 16) % 16;
  const sectionY = Math.floor((y + 64) / 16); // -64 is min Y
  const localY = ((y + 64) % 16 + 16) % 16;
  const sectionIdx = sectionY;

  if (sectionIdx < 0 || sectionIdx >= 24) return;

  const index = sectionIdx * 4096 + localY * 256 + localZ * 16 + localX;
  if (index >= 0 && index < chunk.length) {
    chunk[index] = blockState;
    dirtyChunks.add(key);
  }
}

/** Save all dirty chunks to OPFS. */
async function flushDirtyChunks(): Promise<void> {
  if (!regionStore || !wasmModule || dirtyChunks.size === 0) return;

  const toSave = [...dirtyChunks];
  dirtyChunks.clear();

  for (const key of toSave) {
    const chunk = loadedChunks.get(key);
    if (!chunk) continue;
    const [cxStr, czStr] = key.split(",");
    const cx = parseInt(cxStr);
    const cz = parseInt(czStr);
    try {
      await regionStore.writeChunk(cx, cz, chunk, wasmModule);
    } catch (err) {
      // Re-mark as dirty on failure
      dirtyChunks.add(key);
      postMsg({ type: "log", level: "warn", category: "system", message: `Failed to save chunk ${key}: ${err}` });
    }
  }
}

function startAutoSave(): void {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(() => {
    flushDirtyChunks().catch(() => {});
  }, 30000); // every 30 seconds
}

function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

function handleStop(): void {
  stopAutoSave();
  // Flush dirty chunks synchronously-ish before teardown
  flushDirtyChunks().catch(() => {});

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

  // Close region store
  if (regionStore) {
    regionStore.close();
    regionStore = null;
  }
  loadedChunks.clear();
  dirtyChunks.clear();

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
        // Store in memory for persistence
        const key = chunkKey(msg.cx, msg.cz);
        loadedChunks.set(key, msg.blockStates);
        dirtyChunks.add(key);

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
    case "world_load": {
      // Load or create a world for persistence
      if (regionStore) {
        await flushDirtyChunks();
        regionStore.close();
      }
      loadedChunks.clear();
      dirtyChunks.clear();

      regionStore = new RegionStore(msg.worldName);
      try {
        await regionStore.init();
        startAutoSave();
        postMsg({ type: "log", level: "info", category: "system", message: `World "${msg.worldName}" loaded` });
        postMsg({ type: "world_status", loaded: true, worldName: msg.worldName });
      } catch (err) {
        postMsg({ type: "log", level: "error", category: "system", message: `Failed to load world: ${err}` });
        regionStore = null;
        postMsg({ type: "world_status", loaded: false, worldName: null });
      }
      break;
    }
    case "world_unload": {
      stopAutoSave();
      if (regionStore) {
        await flushDirtyChunks();
        regionStore.close();
        regionStore = null;
      }
      loadedChunks.clear();
      dirtyChunks.clear();
      postMsg({ type: "log", level: "info", category: "system", message: "World unloaded" });
      postMsg({ type: "world_status", loaded: false, worldName: null });
      break;
    }
    case "world_save": {
      if (regionStore) {
        await flushDirtyChunks();
        postMsg({ type: "log", level: "info", category: "system", message: `World saved (${loadedChunks.size} chunks)` });
      }
      break;
    }
  }
};
