import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import {
  Clock,
  Box,
  Users,
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  AlertTriangle,
  Cpu,
  MemoryStick,
  Wifi,
  WifiOff,
} from "lucide-react";

// Matches the Go proxy's Snapshot JSON shape
interface ProxyStats {
  uptime: string;
  uptime_sec: number;
  rooms: number;
  active_clients: number;
  total_bridges: number;
  failed_bridges: number;
  bytes_in: number;
  bytes_out: number;
  goroutines: number;
  mem_alloc_mb: number;
  room_details: RoomDetail[] | null;
  clients: ClientInfo[] | null;
}

interface RoomDetail {
  name: string;
  registered_at: string;
  active_clients: number;
  total_clients: number;
  clients: ClientInfo[] | null;
}

interface ClientInfo {
  id: string;
  username: string;
  ip: string;
  room: string;
  connected_at: string;
  duration_sec: number;
  bytes_in: number;
  bytes_out: number;
}

const MAX_HISTORY = 60;

function formatBytes(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function ProxyDashboard() {
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historyRef = useRef<{
    clients: number[];
    bytesIn: number[];
    bytesOut: number[];
    mem: number[];
  }>({ clients: [], bytesIn: [], bytesOut: [], mem: [] });
  const prevBytesRef = useRef<{ bIn: number; bOut: number; ts: number } | null>(null);
  const [, forceRender] = useState(0);

  const apiBase = import.meta.env.VITE_API_BASE || "";

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/proxy/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ProxyStats = await res.json();
      setStats(data);
      setConnected(true);
      setError(null);

      // Update history
      const h = historyRef.current;
      const now = Date.now();
      h.clients.push(data.active_clients);
      h.mem.push(data.mem_alloc_mb);

      const prev = prevBytesRef.current;
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0) {
          h.bytesIn.push((data.bytes_in - prev.bIn) / dt);
          h.bytesOut.push((data.bytes_out - prev.bOut) / dt);
        }
      }
      prevBytesRef.current = { bIn: data.bytes_in, bOut: data.bytes_out, ts: now };

      for (const key of ["clients", "bytesIn", "bytesOut", "mem"] as const) {
        if (h[key].length > MAX_HISTORY) h[key] = h[key].slice(-MAX_HISTORY);
      }
      forceRender((n) => n + 1);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }, [apiBase]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const h = historyRef.current;

  return (
    <div className="h-full overflow-y-auto p-4 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Proxy Dashboard</h1>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]"}`} />
            <span className="text-xs text-zinc-500">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
        <span className="text-[11px] text-zinc-600 font-mono">
          Polling every 2s
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs">
          <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {!stats ? (
        <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
          <Wifi className="h-4 w-4 mr-2 animate-pulse" />
          Connecting to proxy...
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
            <MetricCard icon={<Clock className="h-3.5 w-3.5" />} label="Uptime" value={formatUptime(stats.uptime_sec)} />
            <MetricCard icon={<Box className="h-3.5 w-3.5" />} label="Rooms" value={stats.rooms.toString()} valueColor={stats.rooms > 0 ? "text-emerald-400" : undefined} />
            <MetricCard icon={<Users className="h-3.5 w-3.5" />} label="Players" value={stats.active_clients.toString()} valueColor={stats.active_clients > 0 ? "text-emerald-400" : undefined} />
            <MetricCard icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="Bytes In" value={formatBytes(stats.bytes_in)} />
            <MetricCard icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} label="Bytes Out" value={formatBytes(stats.bytes_out)} />
            <MetricCard icon={<Layers className="h-3.5 w-3.5" />} label="Bridges" value={stats.total_bridges.toString()} />
            <MetricCard icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Failed" value={stats.failed_bridges.toString()} valueColor={stats.failed_bridges > 0 ? "text-red-400" : undefined} />
            <MetricCard icon={<Cpu className="h-3.5 w-3.5" />} label="Goroutines" value={stats.goroutines.toString()} />
            <MetricCard icon={<MemoryStick className="h-3.5 w-3.5" />} label="Memory" value={`${stats.mem_alloc_mb.toFixed(1)} MB`} />
          </div>

          {/* Sparklines */}
          {h.clients.length > 1 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <SparkCard label="Connections" data={h.clients} color="#34d399" />
              <SparkCard label="Throughput In" data={h.bytesIn} color="#60a5fa" format={formatBytes} suffix="/s" />
              <SparkCard label="Throughput Out" data={h.bytesOut} color="#22d3ee" format={formatBytes} suffix="/s" />
              <SparkCard label="Memory" data={h.mem} color="#fbbf24" suffix=" MB" decimals={1} />
            </div>
          )}

          {/* Rooms */}
          <div>
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-2.5">
              Active Rooms
            </h2>
            {!stats.room_details || stats.room_details.length === 0 ? (
              <Card className="p-5 text-center">
                <p className="text-sm text-zinc-500">
                  No rooms registered. Start a server to create one.
                </p>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {stats.room_details.map((room) => (
                  <RoomCard key={room.name} room={room} />
                ))}
              </div>
            )}
          </div>

          {/* All connections table */}
          {stats.clients && stats.clients.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-2.5">
                All Connections
              </h2>
              <Card className="p-0 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left px-3 py-2 font-medium">Player</th>
                      <th className="text-left px-3 py-2 font-medium">IP</th>
                      <th className="text-left px-3 py-2 font-medium">Room</th>
                      <th className="text-right px-3 py-2 font-medium">Duration</th>
                      <th className="text-right px-3 py-2 font-medium">In</th>
                      <th className="text-right px-3 py-2 font-medium">Out</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {stats.clients.map((c) => (
                      <tr key={c.id} className="border-b border-zinc-800/50 text-zinc-300 hover:bg-zinc-800/30">
                        <td className="px-3 py-2 font-medium text-zinc-100">{c.username || "Unknown"}</td>
                        <td className="px-3 py-2 text-zinc-500">{c.ip}</td>
                        <td className="px-3 py-2">{c.room}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatDuration(c.duration_sec)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBytes(c.bytes_in)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBytes(c.bytes_out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-base font-bold tabular-nums ${valueColor ?? "text-zinc-100"}`}>
        {value}
      </div>
    </Card>
  );
}

function RoomCard({ room }: { room: RoomDetail }) {
  const hasClients = room.clients && room.clients.length > 0;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full ${
              room.active_clients > 0
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                : "bg-zinc-600"
            }`}
          />
          <span className="text-sm font-medium text-zinc-100">{room.name}</span>
        </div>
        <span className="text-[11px] text-zinc-500 tabular-nums bg-zinc-800 px-2 py-0.5 rounded">
          {room.active_clients} / {room.total_clients} clients
        </span>
      </div>
      {hasClients && (
        <div className="border-t border-zinc-800/60">
          {room.clients!.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-4 py-2 text-xs hover:bg-zinc-800/20"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-200">{c.username || "Unknown"}</span>
                <span className="text-zinc-600 font-mono text-[11px]">{c.ip}</span>
              </div>
              <span className="text-zinc-500 tabular-nums text-[11px]">
                {formatDuration(c.duration_sec)} · {formatBytes(c.bytes_in)} in · {formatBytes(c.bytes_out)} out
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 200;
  const h = 40;
  const max = Math.max(...data) * 1.1 || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

function SparkCard({
  label,
  data,
  color,
  format,
  suffix = "",
  decimals,
}: {
  label: string;
  data: number[];
  color: string;
  format?: (n: number) => string;
  suffix?: string;
  decimals?: number;
}) {
  const latest = data.length > 0 ? data[data.length - 1] : 0;
  const formatted = format ? format(latest) + suffix : (decimals !== undefined ? latest.toFixed(decimals) : Math.round(latest).toString()) + suffix;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
        <span className="text-[11px] text-zinc-400 font-mono tabular-nums">{formatted}</span>
      </div>
      <Sparkline data={data} color={color} />
    </Card>
  );
}
