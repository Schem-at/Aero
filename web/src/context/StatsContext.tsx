import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useServer } from "@/context/ServerContext";
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
  pushStats: (stats: ConnectionStats) => void;
  pushPacketLog: (entries: PacketLogEntry[]) => void;
}

const StatsContext = createContext<StatsContextValue | null>(null);

const MAX_PACKET_LOG = 200;
const MAX_HISTORY = 60;

export function StatsProvider({ children }: { children: ReactNode }) {
  const { status } = useServer();
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const [packetLog, setPacketLog] = useState<PacketLogEntry[]>([]);
  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const prevRef = useRef<{ packets_in: number; bytes_in: number; bytes_out: number; ts: number } | null>(null);

  const pushStats = useCallback((newStats: ConnectionStats) => {
    setStats(newStats);

    // Compute deltas for history
    const now = Date.now();
    const prev = prevRef.current;
    if (prev) {
      const dt = (now - prev.ts) / 1000;
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
  }, []);

  const pushPacketLog = useCallback((entries: PacketLogEntry[]) => {
    if (entries.length === 0) return;
    setPacketLog((prev) => {
      const combined = [...prev, ...entries];
      return combined.length > MAX_PACKET_LOG
        ? combined.slice(-MAX_PACKET_LOG)
        : combined;
    });
  }, []);

  // Reset on disconnect
  useEffect(() => {
    if (status === "stopped") {
      setHistory([]);
      prevRef.current = null;
    }
  }, [status]);

  return (
    <StatsContext.Provider value={{ stats, packetLog, history, pushStats, pushPacketLog }}>
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStats must be used within StatsProvider");
  return ctx;
}
