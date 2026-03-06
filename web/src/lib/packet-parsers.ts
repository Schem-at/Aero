import { PACKET_SCHEMAS, type FieldSchema } from "./generated/packet-schemas";

export interface ParsedField {
  name: string;
  value: string | number;
}

// --- Binary readers ---

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

function readVarLong(data: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  let length = 0;
  let byte: number;
  do {
    if (offset + length >= data.length) return [value, offset + length];
    byte = data[offset + length];
    value |= BigInt(byte & 0x7f) << BigInt(length * 7);
    length++;
    if (length > 10) break;
  } while ((byte & 0x80) !== 0);
  return [value, offset + length];
}

function readString(data: Uint8Array, offset: number): [string, number] {
  const [len, afterLen] = readVarInt(data, offset);
  const strBytes = data.slice(afterLen, afterLen + len);
  const str = new TextDecoder().decode(strBytes);
  return [str, afterLen + len];
}

function ensureView(data: Uint8Array, offset: number, size: number): DataView | null {
  if (offset + size > data.length) return null;
  return new DataView(data.buffer, data.byteOffset + offset, size);
}

// --- Schema-driven parser ---

function readField(
  data: Uint8Array,
  offset: number,
  type: string,
): [string | number, number] | null {
  if (offset >= data.length) return null;

  // Primitives
  switch (type) {
    case "varint": {
      const [v, o] = readVarInt(data, offset);
      return [v, o];
    }
    case "optvarint": {
      const [v, o] = readVarInt(data, offset);
      return [v === 0 ? "absent" : v - 1, o];
    }
    case "varlong": {
      const [v, o] = readVarLong(data, offset);
      return [v.toString(), o];
    }
    case "bool": {
      return [data[offset] ? "true" : "false", offset + 1];
    }
    case "i8": {
      const v = (data[offset] << 24) >> 24; // sign extend
      return [v, offset + 1];
    }
    case "u8": {
      return [data[offset], offset + 1];
    }
    case "i16": {
      const view = ensureView(data, offset, 2);
      if (!view) return null;
      return [view.getInt16(0), offset + 2];
    }
    case "u16": {
      const view = ensureView(data, offset, 2);
      if (!view) return null;
      return [view.getUint16(0), offset + 2];
    }
    case "i32": {
      const view = ensureView(data, offset, 4);
      if (!view) return null;
      return [view.getInt32(0), offset + 4];
    }
    case "u32": {
      const view = ensureView(data, offset, 4);
      if (!view) return null;
      return [view.getUint32(0), offset + 4];
    }
    case "f32": {
      const view = ensureView(data, offset, 4);
      if (!view) return null;
      return [view.getFloat32(0).toFixed(4), offset + 4];
    }
    case "i64": {
      const view = ensureView(data, offset, 8);
      if (!view) return null;
      return [view.getBigInt64(0).toString(), offset + 8];
    }
    case "u64": {
      const view = ensureView(data, offset, 8);
      if (!view) return null;
      return [view.getBigUint64(0).toString(), offset + 8];
    }
    case "f64": {
      const view = ensureView(data, offset, 8);
      if (!view) return null;
      return [view.getFloat64(0).toFixed(4), offset + 8];
    }
    case "string": {
      const [s, o] = readString(data, offset);
      return [s, o];
    }
    case "UUID": {
      if (offset + 16 > data.length) return null;
      const hex = Array.from(data.slice(offset, offset + 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      return [uuid, offset + 16];
    }
    case "position": {
      const view = ensureView(data, offset, 8);
      if (!view) return null;
      const val = view.getBigInt64(0);
      let x = Number(val >> 38n);
      let z = Number((val >> 12n) & 0x3FFFFFFn);
      let y = Number(val & 0xFFFn);
      if (x >= (1 << 25)) x -= 1 << 26;
      if (z >= (1 << 25)) z -= 1 << 26;
      if (y >= (1 << 11)) y -= 1 << 12;
      return [`${x}, ${y}, ${z}`, offset + 8];
    }
  }

  // Buffer types: buffer:varint or buffer:N
  if (type.startsWith("buffer:")) {
    const countPart = type.slice(7);
    let count: number;
    let newOff = offset;
    if (countPart === "varint") {
      [count, newOff] = readVarInt(data, offset);
    } else {
      count = parseInt(countPart, 10);
    }
    if (newOff + count > data.length) return null;
    return [`${count} bytes`, newOff + count];
  }

  // Option types: option:TYPE
  if (type.startsWith("option:")) {
    if (offset >= data.length) return null;
    const present = data[offset];
    if (!present) return ["absent", offset + 1];
    const inner = type.slice(7);
    const result = readField(data, offset + 1, inner);
    if (!result) return ["present", offset + 1];
    return result;
  }

  // Mapper types: map:TYPE:k1=v1,k2=v2,...
  if (type.startsWith("map:")) {
    const parts = type.split(":");
    const innerType = parts[1];
    const mappingStr = parts.slice(2).join(":");
    const result = readField(data, offset, innerType);
    if (!result) return null;
    const [rawVal, newOff] = result;
    const mappings = Object.fromEntries(
      mappingStr.split(",").map((p) => p.split("="))
    );
    const mapped = mappings[String(rawVal)];
    return [mapped ? `${mapped} (${rawVal})` : rawVal, newOff];
  }

  // Bitflags: flags:TYPE:name1,name2,...
  if (type.startsWith("flags:")) {
    const parts = type.split(":");
    const innerType = parts[1];
    const flagNames = parts[2].split(",");
    const result = readField(data, offset, innerType);
    if (!result) return null;
    const [rawVal, newOff] = result;
    const val = typeof rawVal === "number" ? rawVal : parseInt(String(rawVal), 10);
    const active = flagNames.filter((_, i) => val & (1 << i));
    return [active.length > 0 ? active.join(", ") : "none", newOff];
  }

  // Array: array:countType:innerType
  if (type.startsWith("array:")) {
    const parts = type.split(":");
    const innerType = parts[2];
    const [count, afterCount] = readVarInt(data, offset);
    if (count > 100) return [`[${count} items]`, afterCount]; // don't parse huge arrays
    const items: string[] = [];
    let off = afterCount;
    for (let i = 0; i < count; i++) {
      const result = readField(data, off, innerType);
      if (!result) break;
      items.push(String(result[0]));
      off = result[1];
    }
    return [items.length <= 5 ? items.join(", ") : `[${items.length} items]`, off];
  }

  return null;
}

function parseWithSchema(schema: FieldSchema[], data: Uint8Array): ParsedField[] {
  const fields: ParsedField[] = [];
  let offset = 0;
  for (const [name, type] of schema) {
    const result = readField(data, offset, type);
    if (!result) break;
    const [value, newOffset] = result;
    fields.push({ name, value });
    offset = newOffset;
  }
  return fields;
}

// --- Manual overrides for packets needing special display logic ---

type Parser = (payload: Uint8Array) => ParsedField[];
const overrides = new Map<string, Parser>();

/** Skip the frame header (packet length VarInt + packet ID VarInt) to get the payload */
function skipFrame(data: Uint8Array): Uint8Array {
  let off = 0;
  [, off] = readVarInt(data, off);
  [, off] = readVarInt(data, off);
  return data.slice(off);
}

// Status Response (Status S→C 0x00) — parse JSON for display
overrides.set("out:Status:0x00", (data) => {
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

// --- Public API ---

export function parsePacketFields(
  state: string,
  direction: "in" | "out",
  packetId: number,
  rawPayloadHex: string
): ParsedField[] | null {
  if (!rawPayloadHex) return null;

  const key = `${direction}:${state}:0x${packetId.toString(16).padStart(2, "0")}`;

  try {
    const bytes = hexToBytes(rawPayloadHex);

    // Check manual overrides first
    const override = overrides.get(key);
    if (override) return override(bytes);

    // Use generated schema
    const schema = PACKET_SCHEMAS[key];
    if (schema) {
      const fields = parseWithSchema(schema, bytes);
      return fields.length > 0 ? fields : null;
    }

    return null;
  } catch {
    return null;
  }
}
