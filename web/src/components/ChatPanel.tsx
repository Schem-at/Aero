import { useState, useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLogs } from "@/context/LogContext";
import { useServer } from "@/context/ServerContext";
import { useWorker } from "@/context/WorkerContext";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ChatPanel() {
  const { logs } = useLogs();
  const { status } = useServer();
  const { queueChat } = useWorker();
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatLogs = logs.filter((l) => l.category === "chat");
  const isRunning = status === "running";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatLogs.length]);

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || !isRunning) return;
    queueChat(trimmed);
    setMessage("");
  }, [message, isRunning, queueChat]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea ref={scrollRef} className="flex-1 p-2 font-mono text-sm">
        {chatLogs.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            No chat messages yet. Start the server and connect a player.
          </div>
        ) : (
          chatLogs.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 py-0.5">
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {formatTime(entry.timestamp)}
              </span>
              <span className="text-green-400 break-all">{entry.message}</span>
            </div>
          ))
        )}
      </ScrollArea>
      <div className="flex gap-2 p-2 border-t border-border">
        <input
          value={message}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleSend()}
          placeholder={isRunning ? "Type a message..." : "Server not running"}
          disabled={!isRunning}
          maxLength={256}
          className="flex-1 font-mono text-sm bg-background border border-border rounded px-3 py-1.5 text-foreground placeholder:text-muted-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          onClick={handleSend}
          disabled={!isRunning || !message.trim()}
          size="sm"
        >
          Send
        </Button>
      </div>
    </div>
  );
}
