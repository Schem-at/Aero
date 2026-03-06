import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader, toScreamingSnake } from "./index.js";

export function generateWgslBlockConstants(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);

  const wgslLines: string[] = [];
  const sorted = [...data.blocksArray].sort((a, b) => a.defaultState - b.defaultState);
  for (const block of sorted) {
    const constName = toScreamingSnake(block.name);
    wgslLines.push(`const ${constName}: u32 = ${block.defaultState}u;`);
  }

  const content = `${header}

/** Block state ID constants for use in WGSL shaders. */
export const BLOCK_CONSTANTS_WGSL = \`
// Block state IDs (${data.blocksArray.length} blocks)
${wgslLines.join("\n")}
\`;
`;

  return {
    path: config.outputs.wgslBlockConstants,
    content,
    name: "wgsl-block-constants",
  };
}
