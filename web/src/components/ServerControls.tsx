import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useServer } from "@/context/ServerContext";
import { useServerConfig } from "@/context/ServerConfigContext";
import { useWorker } from "@/context/WorkerContext";
import { Play, Square, Copy, Check } from "lucide-react";

export function ServerControls() {
  const { status, assignedRoom } = useServer();
  const { config } = useServerConfig();
  const { start, stop } = useWorker();
  const [copied, setCopied] = useState(false);

  const isRunning = status === "running";
  const isBusy = status === "initializing";

  const displayRoom = isRunning && assignedRoom ? assignedRoom : config.subdomain;
  const domain = import.meta.env.VITE_DOMAIN || window.location.hostname;
  const tcpPort = import.meta.env.VITE_TCP_PORT || "25580";
  const address = `${displayRoom}.${domain}:${tcpPort}`;

  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={copyAddress}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-mono transition-colors ${
          isRunning
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
      >
        <span className="truncate max-w-[200px]">{address}</span>
        {copied ? (
          <Check className="h-3 w-3 flex-shrink-0 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3 flex-shrink-0" />
        )}
      </button>

      {!isRunning ? (
        <Button onClick={start} disabled={isBusy} size="sm">
          <Play className="h-4 w-4" />
          Start Server
        </Button>
      ) : (
        <Button onClick={stop} variant="destructive" size="sm">
          <Square className="h-4 w-4" />
          Stop
        </Button>
      )}
    </div>
  );
}
