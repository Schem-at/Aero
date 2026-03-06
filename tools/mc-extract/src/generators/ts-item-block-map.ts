import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader } from "./index.js";

// Items whose name doesn't match the block name
const ITEM_TO_BLOCK_OVERRIDES: Record<string, string> = {
  wheat_seeds: "wheat",
  beetroot_seeds: "beetroots",
  melon_seeds: "melon_stem",
  pumpkin_seeds: "pumpkin_stem",
  redstone: "redstone_wire",
  sweet_berries: "sweet_berry_bush",
  glow_berries: "cave_vines",
  nether_wart: "nether_wart",
  cocoa_beans: "cocoa",
  string: "tripwire",
  potato: "potatoes",
  carrot: "carrots",
  flint_and_steel: "",
  bow: "",
  iron_shovel: "",
};

export function generateTsItemBlockMap(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("ts", data.version.minecraftVersion, data.version.version);

  const map: Record<number, number> = {};
  let count = 0;

  for (const item of data.itemsArray) {
    // Check override first
    if (item.name in ITEM_TO_BLOCK_OVERRIDES) {
      const blockName = ITEM_TO_BLOCK_OVERRIDES[item.name];
      if (blockName === "") continue; // explicitly no block
      const block = data.blocksByName[blockName];
      if (block) {
        map[item.id] = block.defaultState;
        count++;
      }
      continue;
    }

    // Direct name match
    const block = data.blocksByName[item.name];
    if (block) {
      map[item.id] = block.defaultState;
      count++;
    }
  }

  const json = JSON.stringify(map);

  const content = `${header}

// ${count} item-to-block mappings
export const ITEM_TO_BLOCK: Record<number, number> = ${json};
`;

  return {
    path: config.outputs.tsItemBlockMap,
    content,
    name: "ts-item-block-map",
  };
}
