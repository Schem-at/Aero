import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader, toScreamingSnake } from "./index.js";

export function generateTsBlockIds(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);

  const entries: string[] = [];
  const sorted = [...data.blocksArray].sort((a, b) => a.defaultState - b.defaultState);
  for (const block of sorted) {
    const constName = toScreamingSnake(block.name);
    entries.push(`  ${constName}: ${block.defaultState}`);
  }

  const content = `${header}

export const BlockState = {
${entries.join(",\n")},
} as const;
`;

  return {
    path: config.outputs.tsBlockIds,
    content,
    name: "ts-block-ids",
  };
}
