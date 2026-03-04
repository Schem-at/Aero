import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";
import type { LogEntry, LogLevel, LogCategory } from "@/types/log";

const MAX_LOGS = 1000;
let nextId = 0;

type LogAction =
  | { type: "add"; level: LogLevel; category: LogCategory; message: string }
  | { type: "clear" };

function logReducer(state: LogEntry[], action: LogAction): LogEntry[] {
  switch (action.type) {
    case "add": {
      const entry: LogEntry = {
        id: nextId++,
        timestamp: new Date(),
        level: action.level,
        category: action.category,
        message: action.message,
      };
      const next = [...state, entry];
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
    }
    case "clear":
      return [];
  }
}

interface LogContextValue {
  logs: LogEntry[];
  addLog: (level: LogLevel, category: LogCategory, message: string) => void;
  clearLogs: () => void;
}

const LogContext = createContext<LogContextValue | null>(null);

export function LogProvider({ children }: { children: ReactNode }) {
  const [logs, dispatch] = useReducer(logReducer, []);

  const addLog = useCallback(
    (level: LogLevel, category: LogCategory, message: string) => {
      dispatch({ type: "add", level, category, message });
    },
    []
  );

  const clearLogs = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  return (
    <LogContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </LogContext.Provider>
  );
}

export function useLogs() {
  const ctx = useContext(LogContext);
  if (!ctx) throw new Error("useLogs must be used within LogProvider");
  return ctx;
}
