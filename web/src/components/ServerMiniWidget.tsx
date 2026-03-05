import { useState, useEffect } from "react";
import { useServer } from "@/context/ServerContext";
import { useStats } from "@/context/StatsContext";
import { Users, Maximize2 } from "lucide-react";

export function ServerMiniWidget({ onExpand }: { onExpand: () => void }) {
  const { status, assignedRoom } = useServer();
  const { stats } = useStats();
  const [uptime, setUptime] = useState("");

  useEffect(() => {
    if (status !== "running" || !stats?.connected_at_ms) {
      setUptime("");
      return;
    }
    const update = () => {
      const s = Math.floor((Date.now() - stats.connected_at_ms) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setUptime(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, stats?.connected_at_ms]);

  const isRunning = status === "running";
  const isError = status === "error";

  return (
    <button
      onClick={onExpand}
      style={{ viewTransitionName: "server-panel" }}
      className="server-mini-widget fixed bottom-4 right-4 z-40 group cursor-pointer"
    >
      {/* Glow effect */}
      <div className={`absolute -inset-1 rounded-xl blur-md opacity-40 group-hover:opacity-60 transition-opacity ${
        isRunning ? "bg-emerald-500/30" : isError ? "bg-red-500/30" : "bg-amber-500/30"
      }`} />

      <div className="relative flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800/80 bg-[#0a0a0a]/95 backdrop-blur-xl shadow-2xl">
        {/* Status dot */}
        <div className="relative flex-shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${
            isRunning ? "bg-emerald-500" : isError ? "bg-red-500" : "bg-amber-500"
          }`} />
          {isRunning && (
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col items-start min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-200 truncate max-w-[160px]">
              {assignedRoom || "Server"}
            </span>
            {isRunning && stats && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                <Users className="h-2.5 w-2.5" />
                {stats.player_count}
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-600">
            {isRunning ? uptime || "running" : isError ? "error" : "starting..."}
          </span>
        </div>

        {/* Expand icon */}
        <Maximize2 className="h-3.5 w-3.5 text-zinc-600 group-hover:text-emerald-400 transition-colors flex-shrink-0 ml-1" />
      </div>
    </button>
  );
}
