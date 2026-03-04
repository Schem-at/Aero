export interface ParsedField {
  name: string;
  value: string | number;
}

// --- Utility functions ---

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function readVarInt(data: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let length = 0;
  let byte: number;
  do {
    if (offset + length >= data.length) return [value, offset + length];
    byte = data[offset + length];
    value |= (byte & 0x7f) << (length * 7);
    length++;
    if (length > 5) break;
  } while ((byte & 0x80) !== 0);
  return [value, offset + length];
}

function readString(data: Uint8Array, offset: number): [string, number] {
  const [len, afterLen] = readVarInt(data, offset);
  const strBytes = data.slice(afterLen, afterLen + len);
  const str = new TextDecoder().decode(strBytes);
  return [str, afterLen + len];
}

function readUShort(data: Uint8Array, offset: number): [number, number] {
  return [(data[offset] << 8) | data[offset + 1], offset + 2];
}

function readLong(data: Uint8Array, offset: number): [bigint, number] {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return [view.getBigInt64(0), offset + 8];
}

function readFloat(data: Uint8Array, offset: number): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return [view.getFloat32(0), offset + 4];
}

// --- Parser registry ---

type Parser = (payload: Uint8Array) => ParsedField[];

const parsers = new Map<string, Parser>();

// Handshake (Handshaking C→S 0x00)
parsers.set("Handshaking:in:0x00", (data) => {
  const fields: ParsedField[] = [];
  let off = 0;
  let val: number;
  [val, off] = readVarInt(data, off);
  fields.push({ name: "Protocol Version", value: val });
  let str: string;
  [str, off] = readString(data, off);
  fields.push({ name: "Server Address", value: str });
  let port: number;
  [port, off] = readUShort(data, off);
  fields.push({ name: "Port", value: port });
  [val, off] = readVarInt(data, off);
  fields.push({ name: "Next State", value: val === 1 ? "Status (1)" : val === 2 ? "Login (2)" : `${val}` });
  return fields;
});

// Confirm Teleportation (Play C→S 0x00)
parsers.set("Play:in:0x00", (data) => {
  const [val] = readVarInt(data, 0);
  return [{ name: "Teleport ID", value: val }];
});

// Client Information (Configuration C→S 0x00)
parsers.set("Configuration:in:0x00", (data) => {
  const fields: ParsedField[] = [];
  let off = 0;
  let str: string;
  [str, off] = readString(data, off);
  fields.push({ name: "Locale", value: str });
  fields.push({ name: "View Distance", value: data[off] });
  off++;
  let chatMode: number;
  [chatMode, off] = readVarInt(data, off);
  const chatModes = ["Enabled", "Commands Only", "Hidden"];
  fields.push({ name: "Chat Mode", value: chatModes[chatMode] ?? `${chatMode}` });
  fields.push({ name: "Chat Colors", value: data[off] ? "Yes" : "No" });
  off++;
  // Displayed skin parts (bitmask)
  fields.push({ name: "Skin Parts", value: `0x${data[off]?.toString(16).padStart(2, "0")}` });
  off++;
  let mainHand: number;
  [mainHand, off] = readVarInt(data, off);
  fields.push({ name: "Main Hand", value: mainHand === 0 ? "Left" : "Right" });
  fields.push({ name: "Text Filtering", value: data[off] ? "Yes" : "No" });
  off++;
  fields.push({ name: "Allow Server Listings", value: data[off] ? "Yes" : "No" });
  return fields;
});

// Chunk Batch Received (Play C→S 0x0A)
parsers.set("Play:in:0x0a", (data) => {
  const view = new DataView(data.buffer, data.byteOffset, Math.min(4, data.length));
  const chunksPerTick = data.length >= 4 ? view.getFloat32(0) : 0;
  return [{ name: "Chunks Per Tick", value: chunksPerTick.toFixed(2) }];
});

// Keep Alive (Play C→S 0x1B)
parsers.set("Play:in:0x1b", (data) => {
  if (data.length < 8) return [{ name: "Keep Alive ID", value: "(truncated)" }];
  const [val] = readLong(data, 0);
  return [{ name: "Keep Alive ID", value: val.toString() }];
});

// Set Player Position (Play C→S 0x1D)
parsers.set("Play:in:0x1d", (data) => {
  if (data.length < 25) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return [
    { name: "X", value: view.getFloat64(0).toFixed(4) },
    { name: "Y (Feet)", value: view.getFloat64(8).toFixed(4) },
    { name: "Z", value: view.getFloat64(16).toFixed(4) },
    { name: "On Ground", value: data[24] ? "Yes" : "No" },
  ];
});

// Set Player Position and Rotation (Play C→S 0x1E)
parsers.set("Play:in:0x1e", (data) => {
  if (data.length < 33) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return [
    { name: "X", value: view.getFloat64(0).toFixed(4) },
    { name: "Y (Feet)", value: view.getFloat64(8).toFixed(4) },
    { name: "Z", value: view.getFloat64(16).toFixed(4) },
    { name: "Yaw", value: view.getFloat32(24).toFixed(2) },
    { name: "Pitch", value: view.getFloat32(28).toFixed(2) },
    { name: "On Ground", value: data[32] ? "Yes" : "No" },
  ];
});

// Set Player Rotation (Play C→S 0x1F)
parsers.set("Play:in:0x1f", (data) => {
  if (data.length < 9) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return [
    { name: "Yaw", value: view.getFloat32(0).toFixed(2) },
    { name: "Pitch", value: view.getFloat32(4).toFixed(2) },
    { name: "On Ground", value: data[8] ? "Yes" : "No" },
  ];
});

// --- Outbound parsers (raw_payload includes frame: VarInt length + VarInt packetId + payload) ---

/** Skip the frame header (packet length VarInt + packet ID VarInt) to get the payload */
function skipFrame(data: Uint8Array): Uint8Array {
  let off = 0;
  // Skip packet length VarInt
  [, off] = readVarInt(data, off);
  // Skip packet ID VarInt
  [, off] = readVarInt(data, off);
  return data.slice(off);
}

// Status Response (Status S→C 0x00) — contains JSON string
parsers.set("Status:out:0x00", (data) => {
  const payload = skipFrame(data);
  const [json] = readString(payload, 0);
  try {
    const obj = JSON.parse(json);
    const fields: ParsedField[] = [];
    if (obj.version) {
      fields.push({ name: "Version", value: obj.version.name });
      fields.push({ name: "Protocol", value: obj.version.protocol });
    }
    if (obj.players) {
      fields.push({ name: "Online", value: `${obj.players.online}/${obj.players.max}` });
    }
    if (obj.description?.text) {
      fields.push({ name: "MOTD", value: obj.description.text });
    }
    fields.push({ name: "Has Favicon", value: obj.favicon ? `Yes (${Math.round((obj.favicon.length * 3) / 4 / 1024)}KB)` : "No" });
    return fields;
  } catch {
    return [{ name: "JSON", value: json.slice(0, 200) }];
  }
});

// Pong Response (Status S→C 0x01)
parsers.set("Status:out:0x01", (data) => {
  const payload = skipFrame(data);
  if (payload.length < 8) return [{ name: "Payload", value: "(truncated)" }];
  const view = new DataView(payload.buffer, payload.byteOffset, 8);
  return [{ name: "Pong Value", value: view.getBigInt64(0).toString() }];
});

// Ping Request (Status C→S 0x01)
parsers.set("Status:in:0x01", (data) => {
  if (data.length < 8) return [{ name: "Payload", value: "(truncated)" }];
  const view = new DataView(data.buffer, data.byteOffset, 8);
  return [{ name: "Ping Value", value: view.getBigInt64(0).toString() }];
});

// --- Public API ---

export function parsePacketFields(
  state: string,
  direction: "in" | "out",
  packetId: number,
  rawPayloadHex: string
): ParsedField[] | null {
  const key = `${state}:${direction}:0x${packetId.toString(16).padStart(2, "0")}`;
  const parser = parsers.get(key);
  if (!parser) return null;
  try {
    const bytes = hexToBytes(rawPayloadHex);
    return parser(bytes);
  } catch {
    return null;
  }
}
