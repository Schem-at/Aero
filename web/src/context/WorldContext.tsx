import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { listWorlds, createWorld, deleteWorld, updateWorldMeta, type WorldInfo } from "@/lib/opfs-world-manager";

interface WorldContextValue {
  worlds: WorldInfo[];
  activeWorld: string | null;
  isLoaded: boolean;
  refreshWorlds: () => Promise<void>;
  doCreateWorld: (name: string, generator: string) => Promise<void>;
  removeWorld: (name: string) => Promise<void>;
  /** Called by WorkerProvider when worker reports world status */
  setWorldStatus: (loaded: boolean, worldName: string | null) => void;
}

const WorldContext = createContext<WorldContextValue | null>(null);

export function WorldProvider({ children }: { children: ReactNode }) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [activeWorld, setActiveWorld] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshWorlds = useCallback(async () => {
    try {
      const list = await listWorlds();
      setWorlds(list);
    } catch {
      setWorlds([]);
    }
  }, []);

  // Load world list on mount
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      refreshWorlds();
    }
  }, [refreshWorlds]);

  const doCreateWorld = useCallback(async (name: string, generator: string) => {
    await createWorld(name, generator);
    await refreshWorlds();
  }, [refreshWorlds]);

  const removeWorld = useCallback(async (name: string) => {
    await deleteWorld(name);
    if (activeWorld === name) {
      setActiveWorld(null);
      setIsLoaded(false);
    }
    await refreshWorlds();
  }, [activeWorld, refreshWorlds]);

  const setWorldStatus = useCallback((loaded: boolean, worldName: string | null) => {
    setIsLoaded(loaded);
    setActiveWorld(worldName);
    if (loaded && worldName) {
      updateWorldMeta(worldName, { lastPlayed: Date.now() }).catch(() => {});
      refreshWorlds();
    }
  }, [refreshWorlds]);

  return (
    <WorldContext.Provider value={{
      worlds, activeWorld, isLoaded,
      refreshWorlds, doCreateWorld, removeWorld, setWorldStatus,
    }}>
      {children}
    </WorldContext.Provider>
  );
}

export function useWorld() {
  const ctx = useContext(WorldContext);
  if (!ctx) throw new Error("useWorld must be used within WorldProvider");
  return ctx;
}
