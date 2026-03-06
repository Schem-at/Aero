import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader, toScreamingSnake } from "./index.js";

const DIRECTIONS = ["toServer", "toClient"] as const;
const DIR_NAMES: Record<string, string> = {
  toServer: "serverbound",
  toClient: "clientbound",
};
const STATES = ["handshaking", "status", "login", "configuration", "play"] as const;

function extractMappings(protocol: any, state: string, direction: string): Record<string, string> | null {
  const stateData = protocol[state];
  if (!stateData) return null;
  const dirData = stateData[direction];
  if (!dirData) return null;

  // Navigate ProtoDef schema: types.packet[1][0].type[1].mappings
  const packetType = dirData?.types?.packet;
  if (!packetType) return null;

  // packet is [container, [{name: "name", type: [mapper, {type: varint, mappings: {...}}]}, ...]]
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

export function generateRustPacketIds(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("rust", data.version.minecraftVersion, data.version.version);
  let lines = [header, ""];

  for (const dir of DIRECTIONS) {
    const modName = DIR_NAMES[dir];
    lines.push(`pub mod ${modName} {`);

    for (const state of STATES) {
      const mappings = extractMappings(data.protocol, state, dir);
      if (!mappings || Object.keys(mappings).length === 0) continue;

      lines.push(`    pub mod ${state} {`);

      const entries = Object.entries(mappings).sort((a, b) => {
        return parseInt(a[0], 16) - parseInt(b[0], 16);
      });

      for (const [hexId, packetName] of entries) {
        const constName = toScreamingSnake(packetName);
        const id = parseInt(hexId, 16);
        const hexStr = `0x${id.toString(16).toUpperCase().padStart(2, "0")}`;
        lines.push(`        pub const ${constName}: i32 = ${hexStr};`);
      }

      lines.push("    }");
    }

    lines.push("}");
    lines.push("");
  }

  return {
    path: config.outputs.rustPacketIds,
    content: lines.join("\n"),
    name: "rust-packet-ids",
  };
}
