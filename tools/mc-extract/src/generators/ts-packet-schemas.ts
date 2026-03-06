import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader } from "./index.js";

const DIRECTIONS = ["toServer", "toClient"] as const;
const DIR_LABELS: Record<string, string> = { toServer: "in", toClient: "out" };
const STATES = ["handshaking", "status", "login", "configuration", "play"] as const;
const STATE_LABELS: Record<string, string> = {
  handshaking: "Handshaking",
  status: "Status",
  login: "Login",
  configuration: "Configuration",
  play: "Play",
};

// Primitive types the runtime parser understands
const PRIMITIVES = new Set([
  "varint", "varlong", "optvarint",
  "i8", "i16", "i32", "i64",
  "u8", "u16", "u32", "u64",
  "f32", "f64",
  "bool", "string", "UUID", "void",
]);

function toTitleCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\bUuid\b/gi, "UUID")
    .replace(/\b([A-Z])d\b/g, "$1D") // Id → ID
    .replace(/\bNbt\b/g, "NBT");
}

function extractMappings(protocol: any, state: string, direction: string): Record<string, string> | null {
  const stateData = protocol[state];
  if (!stateData) return null;
  const dirData = stateData[direction];
  if (!dirData) return null;
  const packetType = dirData?.types?.packet;
  if (!packetType) return null;
  const containers = packetType[1];
  if (!Array.isArray(containers)) return null;
  for (const field of containers) {
    if (field?.name === "name") {
      const mapperDef = field.type;
      if (Array.isArray(mapperDef) && mapperDef.length >= 2) {
        return mapperDef[1]?.mappings ?? null;
      }
    }
  }
  return null;
}

/**
 * Resolve a ProtoDef type to a runtime parser type string.
 * Returns null if the type is too complex.
 */
function resolveType(
  fieldType: any,
  localTypes: Record<string, any>,
  sharedTypes: Record<string, any>,
): string | null {
  if (typeof fieldType === "string") {
    if (PRIMITIVES.has(fieldType)) return fieldType;
    if (fieldType === "position") return "position";
    // Try resolving named type
    const resolved = localTypes[fieldType] ?? sharedTypes[fieldType];
    if (!resolved) return null;
    return resolveType(resolved, localTypes, sharedTypes);
  }

  if (!Array.isArray(fieldType) || fieldType.length < 2) return null;

  const [typeName, params] = fieldType;

  if (typeName === "buffer") {
    if (params.countType === "varint") return "buffer:varint";
    if (typeof params.count === "number") return `buffer:${params.count}`;
    return null;
  }

  if (typeName === "option") {
    const inner = resolveType(params, localTypes, sharedTypes);
    if (inner && !inner.startsWith("option:")) return `option:${inner}`;
    return null;
  }

  if (typeName === "mapper") {
    const innerType = resolveType(params.type, localTypes, sharedTypes);
    if (!innerType) return null;
    const mappings = params.mappings;
    if (!mappings || typeof mappings !== "object") return innerType;
    const pairs = Object.entries(mappings).map(([k, v]) => `${k}=${v}`).join(",");
    return `map:${innerType}:${pairs}`;
  }

  if (typeName === "bitflags") {
    const innerType = resolveType(params.type, localTypes, sharedTypes);
    if (!innerType) return null;
    const flags = (params.flags as string[]).join(",");
    return `flags:${innerType}:${flags}`;
  }

  if (typeName === "bitfield") {
    // Only handle the well-known position bitfield pattern
    return null;
  }

  if (typeName === "array" && params.countType === "varint" && typeof params.type === "string") {
    const inner = resolveType(params.type, localTypes, sharedTypes);
    if (inner === "string" || inner === "varint") return `array:varint:${inner}`;
  }

  return null;
}

export function generateTsPacketSchemas(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);
  const protocol = data.protocol;
  const sharedTypes = protocol.types ?? {};
  const entries: string[] = [];

  for (const dir of DIRECTIONS) {
    const dirLabel = DIR_LABELS[dir];
    for (const state of STATES) {
      const mappings = extractMappings(protocol, state, dir);
      if (!mappings) continue;

      const stateLabel = STATE_LABELS[state];
      const localTypes = protocol[state]?.[dir]?.types ?? {};

      for (const [hexId, packetName] of Object.entries(mappings)) {
        const id = parseInt(hexId, 16);
        const hex = `0x${id.toString(16).padStart(2, "0")}`;
        const key = `${dirLabel}:${stateLabel}:${hex}`;

        const typeName = `packet_${packetName}`;
        const schema = localTypes[typeName];
        if (!schema || !Array.isArray(schema) || schema[0] !== "container") continue;

        const fields = schema[1] as any[];
        const parsedFields: string[] = [];

        for (const field of fields) {
          if (!field.name || field.anon) continue;
          const resolved = resolveType(field.type, localTypes, sharedTypes);
          if (!resolved) break; // stop at first unparseable field
          if (resolved === "void") continue; // skip void fields
          const displayName = toTitleCase(field.name);
          parsedFields.push(`["${displayName}","${resolved}"]`);
        }

        if (parsedFields.length === 0) continue;
        entries.push(`  "${key}": [${parsedFields.join(",")}],`);
      }
    }
  }

  const content = [
    header,
    "",
    "export type FieldSchema = [name: string, type: string];",
    "",
    "export const PACKET_SCHEMAS: Record<string, FieldSchema[]> = {",
    ...entries,
    "};",
    "",
  ].join("\n");

  return {
    path: config.outputs.tsPacketSchemas,
    content,
    name: "ts-packet-schemas",
  };
}
