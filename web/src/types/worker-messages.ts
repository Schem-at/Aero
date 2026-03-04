import type { LogLevel, LogCategory } from "./log";
import type { ConnectionStats, PacketLogEntry } from "./stats";

// Main → Worker messages
export type MainToWorkerMessage =
  | { type: "start"; wtUrl: string; certHash: string; config: WorkerServerConfig }
  | { type: "stop" }
  | { type: "set_config"; config: WorkerServerConfig }
  | { type: "queue_chat"; message: string }
  | { type: "chunk_data"; cx: number; cz: number; blockStates: Uint16Array }
  | { type: "chunk_batch_done"; count: number };

export interface WorkerServerConfig {
  motd: string;
  max_players: number;
  version_name: string;
  favicon: string | null;
}

// Worker → Main messages
export type WorkerToMainMessage =
  | { type: "log"; level: LogLevel; category: LogCategory; message: string }
  | { type: "stats"; stats: ConnectionStats }
  | { type: "packet_log"; entries: PacketLogEntry[] }
  | { type: "status_change"; status: "running" | "stopped" | "error"; error?: string }
  | { type: "chunks_needed"; chunks: { cx: number; cz: number }[] };
