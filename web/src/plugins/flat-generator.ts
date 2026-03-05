import type { WorldGenerator, ChunkData } from "@/types/plugin";

// Block state IDs (PrismarineJS 1.21.9)
const AIR = 0;
const STONE = 1;
const GRASS_BLOCK = 9; // snowy=false (8 = snowy=true)
const DIRT = 10;
const BEDROCK = 85;
const RED_CONCRETE = 14842;

/**
 * Flat world generator — generates a classic superflat world:
 * Y=-64 (y_offset=0): bedrock
 * Y=-63 to Y=-62 (y_offset=1..2): stone
 * Y=-61 (y_offset=3): dirt
 * Y=-60 (y_offset=4): grass block
 *
 * For chunk (0,0): also places a 16x16 red concrete platform at Y=64 (y_offset=128)
 */
export const flatGenerator: WorldGenerator = {
  id: "flat",
  name: "Flat World",

  generate(cx: number, cz: number): ChunkData {
    const blockStates = new Uint16Array(98304); // 16×384×16, all air

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = z * 16 + x;
        // y_offset 0 = Y=-64: bedrock
        blockStates[0 * 256 + col] = BEDROCK;
        // y_offset 1..2 = Y=-63..-62: stone
        blockStates[1 * 256 + col] = STONE;
        blockStates[2 * 256 + col] = STONE;
        // y_offset 3 = Y=-61: dirt
        blockStates[3 * 256 + col] = DIRT;
        // y_offset 4 = Y=-60: grass block
        blockStates[4 * 256 + col] = GRASS_BLOCK;
      }
    }

    // For chunk (0,0), also add the red concrete platform at Y=64 (y_offset=128)
    if (cx === 0 && cz === 0) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          blockStates[128 * 256 + z * 16 + x] = RED_CONCRETE;
        }
      }
    }

    return { blockStates };
  },
};
