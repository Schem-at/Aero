import { useState, useEffect, useRef } from "react";
import { useStats } from "@/context/StatsContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NbtViewer } from "@/components/NbtViewer";
import { parsePacketFields, type ParsedField } from "@/lib/packet-parsers";
import type { PacketLogEntry } from "@/types/stats";

type Filter = "all" | "unknown" | "Handshaking" | "Status" | "Login" | "Configuration" | "Play";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatNs(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)}µs`;
  return `${ns}ns`;
}

export function PacketInspector() {
  const { packetLog } = useStats();
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = packetLog.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "unknown") return entry.packet_name === "Unknown";
    return entry.state === filter;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  const filters: Filter[] = ["all", "unknown", "Handshaking", "Status", "Login", "Configuration", "Play"];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border flex-wrap">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 text-xs rounded ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {f === "all" ? "All" : f === "unknown" ? "Unknown" : f}
          </button>
        ))}
      </div>
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8 text-sm">
            No packets captured yet.
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-1">Time</th>
                <th className="text-left px-2 py-1">Dir</th>
                <th className="text-left px-2 py-1">State</th>
                <th className="text-left px-2 py-1">ID</th>
                <th className="text-left px-2 py-1">Name</th>
                <th className="text-right px-2 py-1">Size</th>
                <th className="text-right px-2 py-1">Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <PacketRow
                  key={i}
                  entry={entry}
                  expanded={expandedIdx === i}
                  onToggle={() =>
                    setExpandedIdx(expandedIdx === i ? null : i)
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

type DetailTab = "hex" | "nbt" | "parsed";

function PacketRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: PacketLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parsed = parsePacketFields(entry.state, entry.direction, entry.packet_id, entry.raw_payload);
  const hasParsed = parsed !== null && parsed.length > 0;
  const mayHaveNbt = entry.raw_payload?.startsWith("0a ");

  const defaultTab: DetailTab = hasParsed ? "parsed" : "hex";
  const [tab, setTab] = useState<DetailTab>(defaultTab);

  const isUnknown = entry.packet_name === "Unknown";
  const isOut = entry.direction === "out";

  const rowColor = isUnknown
    ? "bg-amber-500/5 text-amber-300"
    : isOut
      ? "text-emerald-300"
      : "text-blue-300";

  const availableTabs: DetailTab[] = ["hex"];
  if (hasParsed) availableTabs.unshift("parsed");
  if (mayHaveNbt) availableTabs.push("nbt");

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer hover:bg-muted/50 border-b border-border/50 ${rowColor}`}
      >
        <td className="px-2 py-1 text-muted-foreground">
          {formatTime(entry.timestamp_ms)}
        </td>
        <td className="px-2 py-1">{isOut ? "→" : "←"}</td>
        <td className="px-2 py-1">{entry.state}</td>
        <td className="px-2 py-1">0x{entry.packet_id.toString(16).padStart(2, "0")}</td>
        <td className="px-2 py-1 font-medium">{entry.packet_name}</td>
        <td className="px-2 py-1 text-right">{entry.size}B</td>
        <td className="px-2 py-1 text-right text-muted-foreground">
          {entry.processing_ns > 0 ? formatNs(entry.processing_ns) : "—"}
        </td>
      </tr>
      {expanded && (
        <tr className={rowColor}>
          <td colSpan={7} className="px-4 py-2 bg-muted/30">
            {availableTabs.length > 1 && (
              <div className="flex gap-1 mb-2">
                {availableTabs.map((t) => (
                  <button
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setTab(t); }}
                    className={`px-2 py-0.5 text-[10px] uppercase rounded ${
                      tab === t
                        ? "bg-zinc-700 text-zinc-200"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {tab === "parsed" && hasParsed ? (
              <ParsedView fields={parsed!} />
            ) : tab === "nbt" && mayHaveNbt ? (
              <NbtViewer hexPayload={entry.raw_payload} />
            ) : (
              <div className="text-[11px] leading-relaxed break-all">
                <span className="text-muted-foreground">Hex: </span>
                {entry.hex_dump || "(empty)"}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ParsedView({ fields }: { fields: ParsedField[] }) {
  return (
    <div className="text-[11px] space-y-0.5">
      {fields.map((f, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-muted-foreground min-w-[120px]">{f.name}:</span>
          <span className="font-medium">{String(f.value)}</span>
        </div>
      ))}
    </div>
  );
}
