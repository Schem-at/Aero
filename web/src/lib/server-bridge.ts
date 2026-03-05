import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerServerConfig,
} from "@/types/worker-messages";
import type { LogLevel, LogCategory } from "@/types/log";
import type { ConnectionStats, PacketLogEntry } from "@/types/stats";

export type LogCallback = (level: LogLevel, category: LogCategory, message: string) => void;
export type StatsCallback = (stats: ConnectionStats) => void;
export type PacketLogCallback = (entries: PacketLogEntry[]) => void;
export type StatusChangeCallback = (status: "running" | "stopped" | "error", error?: string) => void;
export type ChunksNeededCallback = (playerId: number, chunks: { cx: number; cz: number }[]) => void;
export type RoomAssignedCallback = (room: string) => void;

export class ServerBridge {
  private worker: Worker | null = null;

  onLog: LogCallback | null = null;
  onStats: StatsCallback | null = null;
  onPacketLog: PacketLogCallback | null = null;
  onStatusChange: StatusChangeCallback | null = null;
  onChunksNeeded: ChunksNeededCallback | null = null;
  onRoomAssigned: RoomAssignedCallback | null = null;

  start(wtUrl: string, wsUrl: string, certHash: string, config: WorkerServerConfig, subdomain: string): void {
    if (this.worker) {
      this.stop();
    }

    this.worker = new Worker(
      new URL("../workers/server.worker.ts", import.meta.url),
      { type: "module" }
    );

    this.worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "log":
          this.onLog?.(msg.level, msg.category, msg.message);
          break;
        case "stats":
          this.onStats?.(msg.stats);
          break;
        case "packet_log":
          this.onPacketLog?.(msg.entries);
          break;
        case "status_change":
          this.onStatusChange?.(msg.status, msg.error);
          break;
        case "chunks_needed":
          this.onChunksNeeded?.(msg.playerId, msg.chunks);
          break;
        case "room_assigned":
          this.onRoomAssigned?.(msg.room);
          break;
      }
    };

    this.worker.onerror = (err) => {
      const msg = err.message || err.filename
        ? `${err.message ?? "Unknown error"} (${err.filename ?? "?"}:${err.lineno ?? "?"})`
        : "Worker crashed with unknown error";
      this.onLog?.("error", "system", `Worker error: ${msg}`);
      this.onStatusChange?.("error", msg);
    };

    this.send({ type: "start", wtUrl, wsUrl, certHash, config, subdomain });
  }

  stop(): void {
    if (this.worker) {
      this.send({ type: "stop" });
      // Give the worker a moment to clean up, then terminate
      setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
      }, 100);
    }
  }

  setConfig(config: WorkerServerConfig): void {
    this.send({ type: "set_config", config });
  }

  queueChat(message: string): void {
    this.send({ type: "queue_chat", message });
  }

  sendChunkData(playerId: number, cx: number, cz: number, blockStates: Uint16Array): void {
    if (!this.worker) return;
    // Transfer the buffer for zero-copy
    this.worker.postMessage(
      { type: "chunk_data", playerId, cx, cz, blockStates } satisfies MainToWorkerMessage,
      [blockStates.buffer]
    );
  }

  sendChunkBatchDone(playerId: number, count: number): void {
    this.send({ type: "chunk_batch_done", playerId, count });
  }

  regenerateChunks(): void {
    this.send({ type: "regenerate_chunks" });
  }

  setPublic(isPublic: boolean): void {
    this.send({ type: "set_public", public: isPublic });
  }

  private send(msg: MainToWorkerMessage): void {
    this.worker?.postMessage(msg);
  }
}
