import type { ComponentType } from "react";

export interface ChunkData {
  blockStates: Uint16Array; // 98304 entries, indexed [y_offset * 256 + z * 16 + x]
}

export interface WorldGenerator {
  id: string;
  name: string;
  init?(): Promise<void>;
  generate(cx: number, cz: number): Promise<ChunkData> | ChunkData;
  dispose?(): void;
}

export interface Plugin {
  id: string;
  name: string;
  worldGenerator?: WorldGenerator;
  configPanel?: ComponentType;
}
