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
    }
  }, [plugins]);

  const registerPlugin = useCallback((plugin: Plugin) => {
    setPlugins((prev) => {
      const filtered = prev.filter((p) => p.id !== plugin.id);
      return [...filtered, plugin];
    });
  }, []);

  const generateChunks = useCallback(async (chunks: { cx: number; cz: number }[]): Promise<ChunkResult[]> => {
    const gen = generatorRef.current;
    const batchSize = chunks.length;

    // Mark pending
    setWorldGenStats((prev) => ({ ...prev, pendingChunks: prev.pendingChunks + batchSize }));

    const t0 = performance.now();
    const results: ChunkResult[] = [];
    for (const { cx, cz } of chunks) {
      const data: ChunkData = await gen.generate(cx, cz);
      results.push({ cx, cz, blockStates: data.blockStates });
    }
    const elapsed = performance.now() - t0;

    // Update stats
    setWorldGenStats((prev) => {
      const totalChunks = prev.chunksGenerated + batchSize;
      const totalTime = prev.totalTimeMs + elapsed;
      return {
        chunksGenerated: totalChunks,
        pendingChunks: Math.max(0, prev.pendingChunks - batchSize),
        lastBatchSize: batchSize,
        lastBatchTimeMs: elapsed,
        avgChunkTimeMs: totalTime / totalChunks,
        totalTimeMs: totalTime,
      };
    });

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
