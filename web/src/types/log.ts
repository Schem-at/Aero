export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogCategory =
  | "system"
  | "protocol"
  | "handshake"
  | "status"
  | "ping"
  | "transport"
  | "wasm"
  | "login"
  | "encryption";

export interface LogEntry {
  id: number;
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
}
