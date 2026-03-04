import { type ReactNode } from "react";
import { useStats } from "@/context/StatsContext";
import { usePlugins } from "@/context/PluginContext";
import { Card } from "@/components/ui/card";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  Gauge,
  Timer,
  Box,
  Clock,
  Cpu,
} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatNs(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)}µs`;
  return `${ns}ns`;
}

function tpsColor(tps: number): string {
  if (tps >= 19) return "text-emerald-400";
  if (tps >= 15) return "text-yellow-400";
  return "text-red-400";
}

function msptColor(mspt: number): string {
  if (mspt < 50) return "text-emerald-400";
  if (mspt < 100) return "text-yellow-400";
  return "text-red-400";
}

export function StatsPanel() {
  const { stats, history } = useStats();
  const { worldGenStats, activeGenerator } = usePlugins();

  if (!stats) {
    return (
      <div className="text-muted-foreground text-center py-8 text-sm">
        No stats available yet. Start the server and send packets.
      </div>
    );
  }

  const packetTypes = Object.entries(stats.per_packet_type);
  const maxCount = Math.max(1, ...packetTypes.map(([, s]) => s.count));

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="TPS"
          value={stats.tick_count > 0 ? stats.tps.toFixed(1) : "—"}
          icon={<Gauge className="h-3.5 w-3.5" />}
          valueColor={stats.tick_count > 0 ? tpsColor(stats.tps) : undefined}
        />
        <StatCard
          label="MSPT"
          value={stats.tick_count > 0 ? `${stats.mspt.toFixed(1)}ms` : "—"}
          icon={<Timer className="h-3.5 w-3.5" />}
          valueColor={stats.tick_count > 0 ? msptColor(stats.mspt) : undefined}
        />
        <StatCard
          label="Packets In"
          value={stats.packets_in.toString()}
          icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Bytes In"
          value={formatBytes(stats.bytes_in)}
          icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Bytes Out"
          value={formatBytes(stats.bytes_out)}
          icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Packet Types"
          value={packetTypes.length.toString()}
          icon={<Layers className="h-3.5 w-3.5" />}
        />
      </div>

      {/* World Generation Stats */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          World Generation — {activeGenerator.name}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Chunks Generated"
            value={worldGenStats.chunksGenerated.toString()}
            icon={<Box className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Queue"
            value={worldGenStats.pendingChunks.toString()}
            icon={<Layers className="h-3.5 w-3.5" />}
            valueColor={worldGenStats.pendingChunks > 100 ? "text-yellow-400" : worldGenStats.pendingChunks > 0 ? "text-blue-400" : undefined}
          />
          <StatCard
            label="Avg Chunk Time"
            value={worldGenStats.chunksGenerated > 0 ? `${worldGenStats.avgChunkTimeMs.toFixed(2)}ms` : "—"}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Last Batch"
            value={worldGenStats.lastBatchSize > 0 ? `${worldGenStats.lastBatchSize} in ${worldGenStats.lastBatchTimeMs.toFixed(0)}ms` : "—"}
            icon={<Cpu className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {history.length > 1 && (
        <div className="grid grid-cols-2 gap-3">
          <SparklineCard
            label="TPS (30s)"
            data={history.map((s) => s.tps)}
            color="#34d399"
            min={0}
            max={25}
            threshold={20}
          />
          <SparklineCard
            label="MSPT (30s)"
            data={history.map((s) => s.mspt)}
            color="#fbbf24"
            min={0}
            max={Math.max(100, ...history.map((s) => s.mspt))}
            threshold={50}
          />
          <SparklineCard
            label="Packets/sec (30s)"
            data={history.map((s) => s.packetsPerSec)}
            color="#60a5fa"
            min={0}
            max={Math.max(1, ...history.map((s) => s.packetsPerSec)) * 1.2}
          />
          <SparklineCard
            label="Throughput (30s)"
            data={history.map((s) => s.bytesInPerSec + s.bytesOutPerSec)}
            color="#22d3ee"
            min={0}
            max={
              Math.max(
                1,
                ...history.map((s) => s.bytesInPerSec + s.bytesOutPerSec)
              ) * 1.2
            }
          />
        </div>
      )}

      {packetTypes.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Per-Packet Type
          </h3>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-1">Name</th>
                <th className="text-right px-2 py-1">Count</th>
                <th className="text-right px-2 py-1">Bytes</th>
                <th className="text-right px-2 py-1">Avg Time</th>
                <th className="px-2 py-1 w-32">Freq</th>
              </tr>
            </thead>
            <tbody>
              {packetTypes.map(([name, pstats]) => {
                const avgNs =
                  pstats.count > 0
                    ? pstats.total_processing_ns / pstats.count
                    : 0;
                const pct = (pstats.count / maxCount) * 100;
                return (
                  <tr
                    key={name}
                    className="border-b border-border/50 text-zinc-300"
                  >
                    <td className="px-2 py-1 font-medium">{name}</td>
                    <td className="px-2 py-1 text-right">{pstats.count}</td>
                    <td className="px-2 py-1 text-right">
                      {formatBytes(pstats.total_bytes)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {formatNs(avgNs)}
                    </td>
                    <td className="px-2 py-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  valueColor,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  valueColor?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${valueColor ?? ""}`}>
        {value}
      </div>
    </Card>
  );
}

function Sparkline({
  data,
  color,
  min,
  max,
  threshold,
}: {
  data: number[];
  color: string;
  min: number;
  max: number;
  threshold?: number;
}) {
  if (data.length < 2) return null;

  const w = 200;
  const h = 40;
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const thresholdY =
    threshold !== undefined ? h - ((threshold - min) / range) * h : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      {thresholdY !== null && (
        <line
          x1={0}
          y1={thresholdY}
          x2={w}
          y2={thresholdY}
          stroke={color}
          strokeWidth={0.5}
          strokeDasharray="4 3"
          opacity={0.4}
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.join(" ")}
      />
    </svg>
  );
}

function SparklineCard({
  label,
  data,
  color,
  min,
  max,
  threshold,
}: {
  label: string;
  data: number[];
  color: string;
  min: number;
  max: number;
  threshold?: number;
}) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <Sparkline data={data} color={color} min={min} max={max} threshold={threshold} />
    </Card>
  );
}
