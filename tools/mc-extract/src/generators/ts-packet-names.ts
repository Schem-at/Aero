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

function toTitleCase(name: string): string {
  return name
    .replace(/^packet_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

export function generateTsPacketNames(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);
  const entries: string[] = [];

  for (const dir of DIRECTIONS) {
    const dirLabel = DIR_LABELS[dir];
    for (const state of STATES) {
      const mappings = extractMappings(data.protocol, state, dir);
      if (!mappings) continue;
      const stateLabel = STATE_LABELS[state];
      for (const [hexId, packetName] of Object.entries(mappings)) {
        const id = parseInt(hexId, 16);
        const hex = `0x${id.toString(16).padStart(2, "0")}`;
        const name = toTitleCase(packetName);
        entries.push(`  "${dirLabel}:${stateLabel}:${hex}": "${name}",`);
      }
    }
  }

  const content = [
    header,
    "",
    "const PACKET_NAMES: Record<string, string> = {",
    ...entries,
    "};",
    "",
    'export function getPacketName(direction: "in" | "out", state: string, packetId: number): string | undefined {',
    '  return PACKET_NAMES[`${direction}:${state}:0x${packetId.toString(16).padStart(2, "0")}`];',
    "}",
    "",
  ].join("\n");

  return {
    path: config.outputs.tsPacketNames,
    content,
    name: "ts-packet-names",
  };
}
