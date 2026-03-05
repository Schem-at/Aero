import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useServer } from "@/context/ServerContext";
import { useServerConfig } from "@/context/ServerConfigContext";
import { useWorker } from "@/context/WorkerContext";
import { Play, Square, Copy, Check, Globe, Lock } from "lucide-react";

export function ServerControls() {
  const { status, assignedRoom } = useServer();
  const { config } = useServerConfig();
  const { start, stop, setPublic } = useWorker();
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  const isRunning = status === "running";
  const isBusy = status === "initializing";

  const displayRoom = isRunning && assignedRoom ? assignedRoom : config.subdomain;
  const domain = window.location.hostname;
  const address = `${displayRoom}.${domain}`;

  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const togglePublic = useCallback(() => {
    const next = !isPublic;
    setIsPublic(next);
    setPublic(next);
  }, [isPublic, setPublic]);

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
      <button
        onClick={copyAddress}
        className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md border text-[11px] sm:text-xs font-mono transition-colors min-w-0 ${
          isRunning
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
      >
        <span className="truncate max-w-[140px] sm:max-w-[200px]">{address}</span>
        {copied ? (
          <Check className="h-3 w-3 flex-shrink-0 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3 flex-shrink-0" />
        )}
      </button>

      {isRunning && (
        <button
          onClick={togglePublic}
          title={isPublic ? "Listed publicly — click to make private" : "Private — click to list publicly"}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-all ${
            isPublic
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.15)]"
              : "border-zinc-700 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
          }`}
        >
          {isPublic ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{isPublic ? "Public" : "Private"}</span>
        </button>
      )}

      {!isRunning ? (
        <Button onClick={start} disabled={isBusy} size="sm" className="text-xs">
          <Play className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Start</span>
          <span className="xs:hidden">Start</span>
        </Button>
      ) : (
        <Button onClick={stop} variant="destructive" size="sm" className="text-xs">
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      )}
    </div>
  );
}
