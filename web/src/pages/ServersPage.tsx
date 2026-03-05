import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Users, Clock, Globe } from "lucide-react";

interface PublicServer {
  name: string;
  motd: string;
  favicon?: string;
  players: number;
  address: string;
  uptime_sec: number;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function ServerIcon({ favicon, name }: { favicon?: string; name: string }) {
  if (favicon) {
    // Favicon is a data URI like "data:image/png;base64,..."
    return (
      <img
        src={favicon}
        alt={name}
        className="w-12 h-12 rounded-md border border-zinc-800 bg-zinc-950 shrink-0 image-rendering-pixelated"
        style={{ imageRendering: "pixelated" }}
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-md border border-zinc-800 bg-zinc-950 shrink-0 flex items-center justify-center">
      <span className="text-lg font-bold text-zinc-700">
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function ServerCard({ server }: { server: PublicServer }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(server.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [server.address]);

  return (
    <div className="border border-zinc-800 bg-zinc-900/50 rounded-lg p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <ServerIcon favicon={server.favicon} name={server.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-100 truncate">{server.name}</h3>
            <div className="flex items-center gap-1 text-emerald-500 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
            </div>
          </div>
          {server.motd ? (
            <p className="text-xs text-zinc-500 mt-1 truncate">{server.motd}</p>
          ) : (
            <p className="text-xs text-zinc-600 mt-1 italic">No description</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-500 mb-3">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {server.players} {server.players === 1 ? "player" : "players"}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatUptime(server.uptime_sec)}
        </span>
      </div>

      <button
        onClick={copyAddress}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-zinc-800 bg-zinc-950/50 text-xs font-mono text-zinc-400 hover:border-emerald-500/30 hover:text-emerald-400 hover:bg-emerald-500/5 transition-colors"
      >
        <span className="truncate">{server.address}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3 shrink-0" />
        )}
      </button>
    </div>
  );
}

export function ServersPage() {
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch("/api/servers");
        if (res.ok && active) {
          setServers(await res.json());
        }
      } catch {
        // Network error — keep existing list
      } finally {
        if (active) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="h-full p-4 md:p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Globe className="h-5 w-5 text-emerald-500" />
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            Public Servers
          </h1>
          <span className="text-xs text-zinc-600 font-mono">
            {servers.length} online
          </span>
        </div>

        {loading ? (
          <div className="text-sm text-zinc-600 py-12 text-center">
            Loading servers...
          </div>
        ) : servers.length === 0 ? (
          <div className="border border-dashed border-zinc-800 rounded-lg py-16 text-center">
            <Globe className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">No public servers.</p>
            <p className="text-xs text-zinc-600 mt-1">
              Host one from the <span className="text-zinc-400">Server</span> tab and toggle it public.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {servers.map((s) => (
              <ServerCard key={s.name} server={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
