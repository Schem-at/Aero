import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader, toScreamingSnake } from "./index.js";

export function generateRustEntityIds(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("rust", data.version.minecraftVersion, data.version.version);
  let lines = [header, ""];

  const sorted = [...data.entitiesArray].sort((a, b) => a.id - b.id);
  for (const entity of sorted) {
    const constName = toScreamingSnake(entity.name);
    lines.push(`pub const ${constName}: i32 = ${entity.id};`);
  }
  lines.push("");

  return {
    path: config.outputs.rustEntityIds,
    content: lines.join("\n"),
    name: "rust-entity-ids",
  };
}
