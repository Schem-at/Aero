import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Plugin, WorldGenerator, ChunkData } from "@/types/plugin";
import { flatGenerator } from "@/plugins/flat-generator";

interface ChunkResult {
  cx: number;
  cz: number;
  blockStates: Uint16Array;
}

export interface WorldGenStats {
  chunksGenerated: number;
  pendingChunks: number;
  lastBatchSize: number;
  lastBatchTimeMs: number;
  avgChunkTimeMs: number;
  totalTimeMs: number;
}

interface PluginContextValue {
  plugins: Plugin[];
  activeGenerator: WorldGenerator;
  setActiveGenerator: (id: string) => void;
  registerPlugin: (plugin: Plugin) => void;
  generateChunks: (chunks: { cx: number; cz: number }[]) => Promise<ChunkResult[]>;
  clearChunkCache: () => void;
  worldGenStats: WorldGenStats;
}

const PluginContext = createContext<PluginContextValue | null>(null);

const builtinPlugins: Plugin[] = [
  {
    id: "flat",
    name: "Flat World",
    worldGenerator: flatGenerator,
  },
];

const initialGenStats: WorldGenStats = {
  chunksGenerated: 0,
  pendingChunks: 0,
  lastBatchSize: 0,
  lastBatchTimeMs: 0,
  avgChunkTimeMs: 0,
  totalTimeMs: 0,
};

// Chunk cache: avoids regenerating the same chunk for multiple players
const MAX_CACHE_SIZE = 800;
const chunkCache = new Map<string, Uint16Array>();
const pendingChunks = new Map<string, Promise<Uint16Array>>();

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function evictCache(): void {
  if (chunkCache.size <= MAX_CACHE_SIZE) return;
  // Delete oldest entries (Map preserves insertion order)
  const excess = chunkCache.size - MAX_CACHE_SIZE;
  const iter = chunkCache.keys();
  for (let i = 0; i < excess; i++) {
    const key = iter.next().value;
    if (key) chunkCache.delete(key);
  }
}

export function PluginProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>(builtinPlugins);
  const [activeGeneratorId, setActiveGeneratorId] = useState("flat");
  const [worldGenStats, setWorldGenStats] = useState<WorldGenStats>(initialGenStats);
  const generatorRef = useRef<WorldGenerator>(flatGenerator);

  const activeGenerator = plugins
    .map((p) => p.worldGenerator)
    .find((g) => g?.id === activeGeneratorId) ?? flatGenerator;
  generatorRef.current = activeGenerator;

  const setActiveGenerator = useCallback(async (id: string) => {
    const gen = plugins
      .map((p) => p.worldGenerator)
      .find((g) => g?.id === id);
    if (gen) {
      if (gen.init) await gen.init();
      setActiveGeneratorId(id);
      generatorRef.current = gen;
      // Clear cache — new generator produces different terrain
      chunkCache.clear();
      pendingChunks.clear();
    }
  }, [plugins]);

  const registerPlugin = useCallback((plugin: Plugin) => {
    setPlugins((prev) => {
      const filtered = prev.filter((p) => p.id !== plugin.id);
      return [...filtered, plugin];
    });
  }, []);

  const clearChunkCache = useCallback(() => {
    chunkCache.clear();
    pendingChunks.clear();
  }, []);

  const generateChunks = useCallback(async (chunks: { cx: number; cz: number }[]): Promise<ChunkResult[]> => {
    const gen = generatorRef.current;
    const batchSize = chunks.length;

    setWorldGenStats((prev) => ({ ...prev, pendingChunks: prev.pendingChunks + batchSize }));

    const t0 = performance.now();
    const results: ChunkResult[] = [];
    let generated = 0;
    let cacheHits = 0;
    try {
      // Launch all chunk generations concurrently, deduping via cache + in-flight map
      const promises = chunks.map(async ({ cx, cz }): Promise<ChunkResult> => {
        const key = chunkKey(cx, cz);

        // 1. Check cache
        const cached = chunkCache.get(key);
        if (cached) {
          cacheHits++;
          return { cx, cz, blockStates: cached };
        }

        // 2. Check in-flight — reuse if another player already requested this chunk
        const pending = pendingChunks.get(key);
        if (pending) {
          const bs = await pending;
          cacheHits++;
          return { cx, cz, blockStates: bs };
        }

        // 3. Generate — store promise so concurrent requests dedup
        const genPromise = Promise.resolve(gen.generate(cx, cz)).then((data: ChunkData) => {
          const bs = data.blockStates;
          chunkCache.set(key, bs);
          pendingChunks.delete(key);
          evictCache();
          return bs;
        });
        pendingChunks.set(key, genPromise);

        const bs = await genPromise;
        generated++;
        return { cx, cz, blockStates: bs };
      });

      // Await all — GPU calls are still serialized internally by WebGPU,
      // but cache hits resolve instantly and in-flight dedup avoids double work
      const settled = await Promise.all(promises);
      results.push(...settled);
    } finally {
      const elapsed = performance.now() - t0;
      setWorldGenStats((prev) => {
        const totalChunks = prev.chunksGenerated + generated;
        const totalTime = prev.totalTimeMs + elapsed;
        return {
          chunksGenerated: totalChunks,
          pendingChunks: Math.max(0, prev.pendingChunks - batchSize),
          lastBatchSize: batchSize,
          lastBatchTimeMs: elapsed,
          avgChunkTimeMs: totalChunks > 0 ? totalTime / totalChunks : 0,
          totalTimeMs: totalTime,
        };
      });
    }

    return results;
  }, []);

  return (
    <PluginContext.Provider
      value={{
        plugins,
        activeGenerator,
        setActiveGenerator,
        registerPlugin,
        generateChunks,
        clearChunkCache,
        worldGenStats,
      }}
    >
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins() {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error("usePlugins must be used within PluginProvider");
  return ctx;
}
