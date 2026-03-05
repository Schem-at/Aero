import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface ServerConfig {
  motd: string;
  max_players: number;
  version_name: string;
  favicon: string | null;
  subdomain: string;
  whitelist_enabled: boolean;
  whitelist: string[];
  render_distance: number;
  fog_color: number;
  sky_color: number;
}

const STORAGE_KEY = "mc-web-server-config";

const adjectives = [
  "brave", "calm", "dark", "eager", "fast",
  "grand", "happy", "keen", "lucky", "neat",
  "proud", "quick", "red", "sharp", "tall", "warm",
];

const nouns = [
  "fox", "bear", "wolf", "hawk", "lynx",
  "pine", "oak", "reef", "peak", "vale",
  "star", "moon", "bolt", "gale", "dusk", "fern",
];

export function generateSubdomain(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

const defaultConfig: ServerConfig = {
  motd: "A Minecraft server in your browser!",
  max_players: 20,
  version_name: "WASM 1.21",
  favicon: null,
  subdomain: generateSubdomain(),
  whitelist_enabled: false,
  whitelist: [],
  render_distance: 10,
  fog_color: 12638463,  // 0xC0D8FF
  sky_color: 7907327,   // 0x78A7FF
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
