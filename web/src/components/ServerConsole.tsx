import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useLogs } from "@/context/LogContext";
import type { LogLevel, LogCategory } from "@/types/log";

const levelVariant: Record<
  LogLevel,
  "secondary" | "success" | "warning" | "destructive"
> = {
  debug: "secondary",
  info: "success",
  warn: "warning",
  error: "destructive",
};

const categoryColors: Record<LogCategory, string> = {
  system: "text-zinc-400",
  protocol: "text-blue-400",
  handshake: "text-cyan-400",
  status: "text-violet-400",
  ping: "text-amber-400",
  transport: "text-teal-400",
  wasm: "text-emerald-400",
  login: "text-orange-400",
  encryption: "text-rose-400",
  chat: "text-green-400",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ServerConsole() {
  const { logs } = useLogs();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <ScrollArea
      ref={scrollRef}
      className="h-full p-1.5 sm:p-2 font-mono text-[11px] sm:text-sm"
    >
      {logs.length === 0 ? (
        <div className="text-muted-foreground text-center py-8 text-xs sm:text-sm">
          No log entries yet. Start the server to see activity.
        </div>
      ) : (
        logs.map((entry) => (
          <div key={entry.id} className="flex items-start gap-1.5 sm:gap-2 py-0.5">
            <span className="text-muted-foreground shrink-0 tabular-nums hidden sm:inline">
              {formatTime(entry.timestamp)}
            </span>
            <Badge variant={levelVariant[entry.level]} className="shrink-0 text-[9px] sm:text-[10px]">
              {entry.level.toUpperCase()}
            </Badge>
            <span
              className={`shrink-0 font-medium hidden sm:inline ${categoryColors[entry.category]}`}
            >
              [{entry.category}]
            </span>
            <span className="text-zinc-300 break-words min-w-0">{entry.message}</span>
          </div>
        ))
      )}
    </ScrollArea>
  );
}
