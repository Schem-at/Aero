import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { setServerConfig as setWasmConfig } from "@/lib/wasm";

export interface ServerConfig {
  motd: string;
  max_players: number;
  version_name: string;
  favicon: string | null;
}

const STORAGE_KEY = "mc-web-server-config";

const defaultConfig: ServerConfig = {
  motd: "A Minecraft server in your browser!",
  max_players: 20,
  version_name: "WASM 1.21",
  favicon: null,
};

function loadConfig(): ServerConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultConfig, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...defaultConfig };
}

function saveConfig(config: ServerConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

interface ServerConfigContextValue {
  config: ServerConfig;
  updateConfig: (partial: Partial<ServerConfig>) => void;
}

const ServerConfigContext = createContext<ServerConfigContextValue | null>(null);

export function ServerConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>(loadConfig);

  // Push to WASM whenever config changes
  useEffect(() => {
    setWasmConfig(config);
  }, [config]);

  const updateConfig = useCallback((partial: Partial<ServerConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  return (
    <ServerConfigContext.Provider value={{ config, updateConfig }}>
      {children}
    </ServerConfigContext.Provider>
  );
}

export function useServerConfig() {
  const ctx = useContext(ServerConfigContext);
  if (!ctx) throw new Error("useServerConfig must be used within ServerConfigProvider");
  return ctx;
}
