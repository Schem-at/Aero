import mcData from "minecraft-data";
import type { MinecraftData } from "./types.js";

export function loadMinecraftData(version: string): MinecraftData {
  const data = mcData(version);
  if (!data) {
    throw new Error(`minecraft-data does not support version "${version}"`);
  }

  return {
    version: data.version,
    protocol: data.protocol,
    blocksArray: data.blocksArray as any,
    blocksByName: data.blocksByName as any,
    entitiesArray: data.entitiesArray as any,
    itemsArray: data.itemsArray as any,
  };
}
