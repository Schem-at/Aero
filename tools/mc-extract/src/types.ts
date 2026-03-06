export interface BlockData {
  id: number;
  name: string;
  defaultState: number;
  minStateId: number;
  maxStateId: number;
}

export interface EntityData {
  id: number;
  name: string;
  displayName: string;
}

export interface ItemData {
  id: number;
  name: string;
}

export interface ProtocolMapping {
  [hexId: string]: string;
}

export interface GeneratorResult {
  path: string;
  content: string;
  name: string;
}

export interface Config {
  version: string;
  projectRoot: string;
  outputs: {
    rustPacketIds: string;
    rustEntityIds: string;
    tsItemBlockMap: string;
    tsBlockIds: string;
    wgslBlockConstants: string;
    tsProtocolMeta: string;
    rustBlockRegistry: string;
    tsPacketNames: string;
  };
}

export interface MinecraftData {
  version: { version: number; minecraftVersion: string };
  protocol: any;
  blocksArray: BlockData[];
  blocksByName: Record<string, BlockData>;
  entitiesArray: EntityData[];
  itemsArray: ItemData[];
}
