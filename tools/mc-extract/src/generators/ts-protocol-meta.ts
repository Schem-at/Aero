import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader } from "./index.js";

export function generateTsProtocolMeta(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);

  const content = `${header}

export const PROTOCOL_VERSION = ${data.version.version};
export const MINECRAFT_VERSION = "${data.version.minecraftVersion}";
`;

  return {
    path: config.outputs.tsProtocolMeta,
    content,
    name: "ts-protocol-meta",
  };
}
