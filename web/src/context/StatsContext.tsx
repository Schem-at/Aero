import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useServer } from "@/context/ServerContext";
import { getStats, getPacketLog } from "@/lib/wasm";
import type { ConnectionStats, PacketLogEntry } from "@/types/stats";

export interface StatsSnapshot {
  timestamp: number;
  tps: number;
  mspt: number;
  packetsPerSec: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
}

interface StatsContextValue {
  stats: ConnectionStats | null;
  packetLog: PacketLogEntry[];
  history: StatsSnapshot[];
}

const StatsContext = createContext<StatsContextValue | null>(null);

const MAX_PACKET_LOG = 200;
const MAX_HISTORY = 60;
const POLL_MS = 500;

export function StatsProvider({ children }: { children: ReactNode }) {
  const { status } = useServer();
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const [packetLog, setPacketLog] = useState<PacketLogEntry[]>([]);
  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRef = useRef<{ packets_in: number; bytes_in: number; bytes_out: number; ts: number } | null>(null);

  useEffect(() => {
    if (status !== "running") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      prevRef.current = null;
      return;
    }

    intervalRef.current = setInterval(() => {
      try {
        const newStats = getStats();
        if (newStats) {
          setStats(newStats);

          // Compute deltas for history
          const now = Date.now();
          const prev = prevRef.current;
          if (prev) {
            const dt = (now - prev.ts) / 1000; // seconds
            if (dt > 0) {
              const snapshot: StatsSnapshot = {
                timestamp: now,
                tps: newStats.tps,
                mspt: newStats.mspt,
                packetsPerSec: (newStats.packets_in - prev.packets_in) / dt,
                bytesInPerSec: (newStats.bytes_in - prev.bytes_in) / dt,
                bytesOutPerSec: (newStats.bytes_out - prev.bytes_out) / dt,
              };
              setHistory((h) => {
                const next = [...h, snapshot];
                return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
              });
            }
          }
          prevRef.current = {
            packets_in: newStats.packets_in,
            bytes_in: newStats.bytes_in,
            bytes_out: newStats.bytes_out,
            ts: now,
          };
        }

        const newEntries = getPacketLog();
        if (newEntries.length > 0) {
          setPacketLog((prev) => {
            const combined = [...prev, ...newEntries];
            return combined.length > MAX_PACKET_LOG
              ? combined.slice(-MAX_PACKET_LOG)
              : combined;
          });
        }
      } catch {
        // WASM not ready yet
      }
    }, POLL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  // Reset on disconnect
  useEffect(() => {
    if (status === "stopped") {
      setHistory([]);
      prevRef.current = null;
    }
  }, [status]);

  return (
    <StatsContext.Provider value={{ stats, packetLog, history }}>
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStats must be used within StatsProvider");
  return ctx;
}
