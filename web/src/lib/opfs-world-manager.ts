/**
 * World management utilities for OPFS-stored worlds.
 *
 * OPFS layout:
 *   /worlds/{name}/region/r.{rx}.{rz}.mca
 *   /worlds/{name}/meta.json   (created, lastPlayed, generator)
 */

export interface WorldInfo {
  name: string;
  created: number;
  lastPlayed: number;
  generator: string;
}

async function getWorldsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("worlds", { create: true });
}

export async function listWorlds(): Promise<WorldInfo[]> {
  const worldsDir = await getWorldsDir();
  const worlds: WorldInfo[] = [];

  for await (const [name, handle] of worldsDir as any) {
    if (handle.kind !== "directory") continue;

    try {
      const metaFile = await (handle as FileSystemDirectoryHandle).getFileHandle("meta.json");
      const file = await metaFile.getFile();
      const text = await file.text();
      const meta = JSON.parse(text);
      worlds.push({
        name,
        created: meta.created ?? Date.now(),
        lastPlayed: meta.lastPlayed ?? Date.now(),
        generator: meta.generator ?? "unknown",
      });
    } catch {
      // World without meta — still list it
      worlds.push({
        name,
        created: 0,
        lastPlayed: 0,
        generator: "unknown",
      });
    }
  }

  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function createWorld(name: string, generator: string): Promise<void> {
  const worldsDir = await getWorldsDir();
  const worldDir = await worldsDir.getDirectoryHandle(name, { create: true });
  await worldDir.getDirectoryHandle("region", { create: true });

  // Write meta
  const meta: WorldInfo = {
    name,
    created: Date.now(),
    lastPlayed: Date.now(),
    generator,
  };
  const metaFile = await worldDir.getFileHandle("meta.json", { create: true });
  const writable = await metaFile.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

export async function updateWorldMeta(name: string, updates: Partial<WorldInfo>): Promise<void> {
  const worldsDir = await getWorldsDir();
  const worldDir = await worldsDir.getDirectoryHandle(name);

  let meta: WorldInfo;
  try {
    const existingMeta = await worldDir.getFileHandle("meta.json");
    const file = await existingMeta.getFile();
    meta = JSON.parse(await file.text());
  } catch {
    meta = { name, created: Date.now(), lastPlayed: Date.now(), generator: "unknown" };
  }

  Object.assign(meta, updates);

  const metaFile = await worldDir.getFileHandle("meta.json", { create: true });
  const writable = await metaFile.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

export async function deleteWorld(name: string): Promise<void> {
  const worldsDir = await getWorldsDir();
  await worldsDir.removeEntry(name, { recursive: true });
}
