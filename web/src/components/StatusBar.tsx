import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { useServer, type ServerStatus } from "@/context/ServerContext";
import { useStats } from "@/context/StatsContext";
import { Users, Clock, Globe } from "lucide-react";

const statusConfig: Record<
  ServerStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary" }
> = {
  stopped: { label: "Stopped", variant: "secondary" },
  initializing: { label: "Initializing...", variant: "warning" },
  running: { label: "Running", variant: "success" },
  error: { label: "Error", variant: "destructive" },
};

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function StatusBar() {
  const { status, errorMessage } = useServer();
  const { stats } = useStats();
  const config = statusConfig[status];
  const [uptime, setUptime] = useState("");

  useEffect(() => {
    if (status !== "running" || !stats?.connected_at_ms) {
      setUptime("");
      return;
    }

    const update = () => setUptime(formatUptime(Date.now() - stats.connected_at_ms));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, stats?.connected_at_ms]);

  return (
    <div className="flex items-center gap-3">
      <Badge variant={config.variant}>{config.label}</Badge>
      {status === "running" && stats && (
        <>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {stats.player_count} online
          </span>
          {uptime && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {uptime}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="h-3 w-3" />
            localhost:25565
          </span>
        </>
      )}
      {errorMessage && (
        <span className="text-sm text-red-400">{errorMessage}</span>
      )}
    </div>
  );
}
