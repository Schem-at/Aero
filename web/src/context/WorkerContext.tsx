import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { ServerBridge } from "@/lib/server-bridge";
import { useServer } from "@/context/ServerContext";
import { useLogs } from "@/context/LogContext";
import { useStats } from "@/context/StatsContext";
import { useServerConfig } from "@/context/ServerConfigContext";
import { usePlugins } from "@/context/PluginContext";

interface WorkerContextValue {
  start: () => void;
  stop: () => void;
  queueChat: (message: string) => void;
  regenerateChunks: () => void;
}

const WorkerContext = createContext<WorkerContextValue | null>(null);

export function WorkerProvider({ children }: { children: ReactNode }) {
  const { setStatus, setError, setAssignedRoom } = useServer();
  const { addLog, clearLogs } = useLogs();
  const { pushStats, pushPacketLog } = useStats();
  const { config } = useServerConfig();
  const { generateChunks } = usePlugins();
  const bridgeRef = useRef<ServerBridge | null>(null);

  // Keep a ref to generateChunks so the callback doesn't go stale
  const generateChunksRef = useRef(generateChunks);
  generateChunksRef.current = generateChunks;

  const getBridge = useCallback(() => {
    if (!bridgeRef.current) {
      bridgeRef.current = new ServerBridge();
    }
    return bridgeRef.current;
  }, []);

  const start = useCallback(() => {
    const bridge = getBridge();

    bridge.onLog = addLog;
    bridge.onStats = pushStats;
    bridge.onPacketLog = pushPacketLog;
    bridge.onStatusChange = (status, error) => {
      if (status === "error" && error) {
        setError(error);
      } else if (status === "running") {
        setStatus("running");
      } else if (status === "stopped") {
        setStatus("stopped");
      }
    };
    bridge.onRoomAssigned = (room) => {
      setAssignedRoom(room);
    };
    bridge.onChunksNeeded = async (chunks) => {
      try {
        const gen = generateChunksRef.current;
        const results = await gen(chunks);
        for (const { cx, cz, blockStates } of results) {
          bridge.sendChunkData(cx, cz, blockStates);
        }
        bridge.sendChunkBatchDone(results.length);
      } catch (err) {
        addLog("error", "system", `Chunk generation failed: ${err}`);
        // Still send batch done so the client doesn't hang
        bridge.sendChunkBatchDone(0);
      }
    };

    setStatus("initializing");
    addLog("info", "system", "Starting server worker...");

    const certHash = import.meta.env.VITE_CERT_HASH || "";
    const wtPort = import.meta.env.VITE_WT_PORT || "4433";
    const wtHost = import.meta.env.VITE_WT_HOST || window.location.hostname;
    const wtUrl = `https://${wtHost}:${wtPort}/connect`;
    bridge.start(wtUrl, certHash, config, config.subdomain);
  }, [getBridge, addLog, pushStats, pushPacketLog, setStatus, setError, setAssignedRoom, config]);

  const stop = useCallback(() => {
    bridgeRef.current?.stop();
    setStatus("stopped");
    clearLogs();
  }, [setStatus, clearLogs]);

  const queueChat = useCallback((message: string) => {
    bridgeRef.current?.queueChat(message);
  }, []);

  const regenerateChunks = useCallback(() => {
    bridgeRef.current?.regenerateChunks();
  }, []);

  // Push config changes to worker
  useEffect(() => {
    bridgeRef.current?.setConfig(config);
  }, [config]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      bridgeRef.current?.stop();
    };
  }, []);

  return (
    <WorkerContext.Provider value={{ start, stop, queueChat, regenerateChunks }}>
      {children}
    </WorkerContext.Provider>
  );
}

export function useWorker() {
  const ctx = useContext(WorkerContext);
  if (!ctx) throw new Error("useWorker must be used within WorkerProvider");
  return ctx;
}
