/**
 * OPFS-backed Anvil region file store.
 *
 * Uses FileSystemSyncAccessHandle for synchronous random-access I/O
 * inside a Web Worker. Each region file is stored at:
 *   /worlds/{worldName}/region/r.{rx}.{rz}.mca
 *
 * Requires WASM anvil_* functions for serialization/header management.
 */

interface WasmAnvil {
  anvil_serialize_chunk(cx: number, cz: number, block_states: Uint16Array): Uint8Array;
  anvil_deserialize_chunk(entry: Uint8Array): Uint8Array;
  anvil_region_filename(cx: number, cz: number): string;
  anvil_new_region_header(): Uint8Array;
  anvil_parse_region_header(header: Uint8Array): string;
  anvil_update_region_header(
    header: Uint8Array, lx: number, lz: number,
    offset: number, count: number, timestamp: number
  ): Uint8Array;
  anvil_chunk_location(header: Uint8Array, lx: number, lz: number): string;
  anvil_next_free_sector(header: Uint8Array): number;
  anvil_sectors_needed(compressed_len: number): number;
}

const SECTOR_SIZE = 4096;
const HEADER_SIZE = 8192;

interface RegionHandle {
  handle: FileSystemSyncAccessHandle;
  header: Uint8Array;
  filename: string;
}

export class RegionStore {
  private worldName: string;
  private regionDir: FileSystemDirectoryHandle | null = null;
  private regions = new Map<string, RegionHandle>();

  constructor(worldName: string) {
    this.worldName = worldName;
  }

  async init(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const worldsDir = await root.getDirectoryHandle("worlds", { create: true });
    const worldDir = await worldsDir.getDirectoryHandle(this.worldName, { create: true });
    this.regionDir = await worldDir.getDirectoryHandle("region", { create: true });
  }

  private async getRegion(filename: string, wasm: WasmAnvil): Promise<RegionHandle> {
    const cached = this.regions.get(filename);
    if (cached) return cached;

    if (!this.regionDir) throw new Error("RegionStore not initialized");

    const fileHandle = await this.regionDir.getFileHandle(filename, { create: true });
    const handle = await fileHandle.createSyncAccessHandle();

    let header: Uint8Array;
    if (handle.getSize() < HEADER_SIZE) {
      // New region file — write empty header
      header = wasm.anvil_new_region_header();
      handle.write(header, { at: 0 });
      handle.flush();
    } else {
      // Read existing header
      header = new Uint8Array(HEADER_SIZE);
      handle.read(header, { at: 0 });
    }

    const region: RegionHandle = { handle, header, filename };
    this.regions.set(filename, region);
    return region;
  }

  async readChunk(cx: number, cz: number, wasm: WasmAnvil): Promise<Uint16Array | null> {
    const filename = wasm.anvil_region_filename(cx, cz);
    const region = await this.getRegion(filename, wasm);

    const lx = ((cx % 32) + 32) % 32;
    const lz = ((cz % 32) + 32) % 32;

    const locationJson = wasm.anvil_chunk_location(region.header, lx, lz);
    if (locationJson === "null") return null;

    const location = JSON.parse(locationJson) as {
      offset: number; count: number; byteOffset: number; byteLen: number;
    };

    // Read chunk entry from file
    const entryData = new Uint8Array(location.byteLen);
    const bytesRead = region.handle.read(entryData, { at: location.byteOffset });
    if (bytesRead < location.byteLen) return null;

    // Deserialize via WASM
    const result = wasm.anvil_deserialize_chunk(entryData);
    if (result.length === 0) return null;

    // First 8 bytes are cx, cz as i32 LE — skip them
    const blockStates = new Uint16Array(result.buffer, result.byteOffset + 8, (result.length - 8) / 2);
    return blockStates;
  }

  async writeChunk(cx: number, cz: number, blockStates: Uint16Array, wasm: WasmAnvil): Promise<void> {
    const filename = wasm.anvil_region_filename(cx, cz);
    const region = await this.getRegion(filename, wasm);

    const lx = ((cx % 32) + 32) % 32;
    const lz = ((cz % 32) + 32) % 32;

    // Serialize chunk to region entry format
    const entry = wasm.anvil_serialize_chunk(cx, cz, blockStates);
    const sectorCount = entry.length / SECTOR_SIZE;

    // Find where to write (append-only)
    const nextSector = wasm.anvil_next_free_sector(region.header);

    // Write chunk data
    const byteOffset = nextSector * SECTOR_SIZE;
    region.handle.write(entry, { at: byteOffset });

    // Update header
    const timestamp = Math.floor(Date.now() / 1000);
    region.header = wasm.anvil_update_region_header(
      region.header, lx, lz, nextSector, sectorCount, timestamp
    );

    // Write header back
    region.handle.write(region.header, { at: 0 });
    region.handle.flush();
  }

  close(): void {
    for (const region of this.regions.values()) {
      try {
        region.handle.close();
      } catch {
        // Ignore close errors
      }
    }
    this.regions.clear();
  }
}
