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
export type ChunksNeededCallback = (chunks: { cx: number; cz: number }[]) => void;

export class ServerBridge {
  private worker: Worker | null = null;

  onLog: LogCallback | null = null;
  onStats: StatsCallback | null = null;
  onPacketLog: PacketLogCallback | null = null;
  onStatusChange: StatusChangeCallback | null = null;
  onChunksNeeded: ChunksNeededCallback | null = null;

  start(wtUrl: string, certHash: string, config: WorkerServerConfig): void {
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
          this.onChunksNeeded?.(msg.chunks);
          break;
      }
    };

    this.worker.onerror = (err) => {
      this.onLog?.("error", "system", `Worker error: ${err.message}`);
      this.onStatusChange?.("error", err.message);
    };

    this.send({ type: "start", wtUrl, certHash, config });
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

  sendChunkData(cx: number, cz: number, blockStates: Uint16Array): void {
    if (!this.worker) return;
    // Transfer the buffer for zero-copy
    this.worker.postMessage(
      { type: "chunk_data", cx, cz, blockStates } satisfies MainToWorkerMessage,
      [blockStates.buffer]
    );
  }

  sendChunkBatchDone(count: number): void {
    this.send({ type: "chunk_batch_done", count });
  }

  private send(msg: MainToWorkerMessage): void {
    this.worker?.postMessage(msg);
  }
}
