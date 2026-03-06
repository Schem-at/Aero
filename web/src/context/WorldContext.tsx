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
  createAndLoadWorld: (name: string, generator: string) => Promise<void>;
  loadWorld: (name: string) => void;
  unloadWorld: () => void;
  saveWorld: () => void;
  removeWorld: (name: string) => Promise<void>;
  // Called by WorkerProvider to wire up the bridge
  setWorldStatus: (loaded: boolean, worldName: string | null) => void;
}

const WorldContext = createContext<WorldContextValue | null>(null);

// Store the bridge actions so WorldContext can call them
let bridgeLoadWorld: ((name: string) => void) | null = null;
let bridgeUnloadWorld: (() => void) | null = null;
let bridgeSaveWorld: (() => void) | null = null;

export function setBridgeWorldActions(
  load: (name: string) => void,
  unload: () => void,
  save: () => void,
) {
  bridgeLoadWorld = load;
  bridgeUnloadWorld = unload;
  bridgeSaveWorld = save;
}

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

  const createAndLoadWorld = useCallback(async (name: string, generator: string) => {
    await createWorld(name, generator);
    await refreshWorlds();
    bridgeLoadWorld?.(name);
  }, [refreshWorlds]);

  const loadWorld = useCallback((name: string) => {
    bridgeLoadWorld?.(name);
  }, []);

  const unloadWorld = useCallback(() => {
    bridgeUnloadWorld?.();
  }, []);

  const saveWorld = useCallback(() => {
    bridgeSaveWorld?.();
  }, []);

  const removeWorld = useCallback(async (name: string) => {
    if (activeWorld === name) {
      bridgeUnloadWorld?.();
    }
    await deleteWorld(name);
    await refreshWorlds();
  }, [activeWorld, refreshWorlds]);

  const setWorldStatus = useCallback((loaded: boolean, worldName: string | null) => {
    setIsLoaded(loaded);
    setActiveWorld(worldName);
    if (loaded && worldName) {
      updateWorldMeta(worldName, { lastPlayed: Date.now() }).catch(() => {});
    }
  }, []);

  return (
    <WorldContext.Provider value={{
      worlds, activeWorld, isLoaded,
      refreshWorlds, createAndLoadWorld, loadWorld, unloadWorld, saveWorld, removeWorld,
      setWorldStatus,
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
