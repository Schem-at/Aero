import type { LogLevel, LogCategory } from "@/types/log";

type LogCallback = (
  level: LogLevel,
  category: LogCategory,
  message: string
) => void;

let wasmModule: typeof import("../../public/wasm/minecraft_web_server") | null =
  null;
let logCallback: LogCallback | null = null;

declare global {
  interface Window {
    __mc_server_log?: (level: string, category: string, message: string) => void;
  }
}

export function setWasmLogCallback(cb: LogCallback) {
  logCallback = cb;
  window.__mc_server_log = (level: string, category: string, message: string) => {
    logCallback?.(level as LogLevel, category as LogCategory, message);
  };
}

export async function initWasm(): Promise<void> {
  if (wasmModule) return;

  // Set up the log bridge before init
  if (!window.__mc_server_log && logCallback) {
    setWasmLogCallback(logCallback);
  }

  const mod = await import("../../public/wasm/minecraft_web_server");
  await mod.default();
  wasmModule = mod;
}

export function handlePacket(data: Uint8Array): Uint8Array {
  if (!wasmModule) throw new Error("WASM not initialized");
  const result = wasmModule.handle_packet(data);
  return new Uint8Array(result);
}

export function resetState(): void {
  if (!wasmModule) throw new Error("WASM not initialized");
  wasmModule.reset_state();
}

export function isInitialized(): boolean {
  return wasmModule !== null;
}

export function getStats(): import("@/types/stats").ConnectionStats | null {
  if (!wasmModule) return null;
  try {
    const json = (wasmModule as any).get_stats();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getPacketLog(): import("@/types/stats").PacketLogEntry[] {
  if (!wasmModule) return [];
  try {
    const json = (wasmModule as any).get_packet_log();
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function getPendingAuth(): string | null {
  if (!wasmModule) return null;
  const result = (wasmModule as any).get_pending_auth() as string;
  return result || null;
}

export function completeAuth(mojangResponse: string): Uint8Array {
  if (!wasmModule) throw new Error("WASM not initialized");
  const result = (wasmModule as any).complete_auth(mojangResponse);
  return new Uint8Array(result);
}

export function queueChat(message: string): void {
  if (!wasmModule) return;
  (wasmModule as any).queue_chat(message);
}

export function setServerConfig(config: {
  motd: string;
  max_players: number;
  version_name: string;
  favicon: string | null;
}): void {
  if (!wasmModule) return;
  (wasmModule as any).set_server_config(JSON.stringify(config));
}
