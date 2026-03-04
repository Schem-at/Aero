import { useState, useMemo } from "react";
import { parseNbt, type NbtValue } from "@/lib/nbt-parser";

const TYPE_COLORS: Record<string, string> = {
  byte: "text-red-400",
  short: "text-orange-400",
  int: "text-green-400",
  long: "text-emerald-400",
  float: "text-cyan-400",
  double: "text-sky-400",
  string: "text-blue-400",
  byte_array: "text-pink-400",
  int_array: "text-rose-400",
  long_array: "text-purple-400",
  compound: "text-yellow-400",
  list: "text-amber-400",
};

function NbtNode({ name, value, depth }: { name?: string; value: NbtValue; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const color = TYPE_COLORS[value.type] ?? "text-zinc-400";
  const indent = depth * 16;

  if (value.type === "compound") {
    const entries = Object.entries(value.value);
    return (
      <div>
        <div
          className="flex items-center gap-1 cursor-pointer hover:bg-muted/30 rounded px-1"
          style={{ paddingLeft: indent }}
          onClick={() => setOpen(!open)}
        >
          <span className="text-zinc-500 text-[10px] w-3">{open ? "▼" : "▶"}</span>
          {name && <span className="text-zinc-300">{name}:</span>}
          <span className={`text-[10px] ${color}`}>{`{${entries.length}}`}</span>
        </div>
        {open &&
          entries.map(([k, v]) => (
            <NbtNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
      </div>
    );
  }

  if (value.type === "list") {
    return (
      <div>
        <div
          className="flex items-center gap-1 cursor-pointer hover:bg-muted/30 rounded px-1"
          style={{ paddingLeft: indent }}
          onClick={() => setOpen(!open)}
        >
          <span className="text-zinc-500 text-[10px] w-3">{open ? "▼" : "▶"}</span>
          {name && <span className="text-zinc-300">{name}:</span>}
          <span className={`text-[10px] ${color}`}>{`[${value.value.length} ${value.elementType}]`}</span>
        </div>
        {open &&
          value.value.map((v, i) => (
            <NbtNode key={i} name={`${i}`} value={v} depth={depth + 1} />
          ))}
      </div>
    );
  }

  if (value.type === "long_array" || value.type === "int_array" || value.type === "byte_array") {
    const arr = value.value;
    const preview = arr.length > 8 ? `[${arr.length} entries]` : `[${arr.join(", ")}]`;
    return (
      <div
        className="flex items-center gap-1 px-1"
        style={{ paddingLeft: indent + 12 }}
      >
        {name && <span className="text-zinc-300">{name}:</span>}
        <span className={`${color}`}>{preview}</span>
        <span className="text-zinc-600 text-[10px]">{value.type}</span>
      </div>
    );
  }

  // Scalar types
  const displayValue = value.type === "string" ? `"${value.value}"` : String(value.value);

  return (
    <div
      className="flex items-center gap-1 px-1"
      style={{ paddingLeft: indent + 12 }}
    >
      {name && <span className="text-zinc-300">{name}:</span>}
      <span className={color}>{displayValue}</span>
      <span className="text-zinc-600 text-[10px]">{value.type}</span>
    </div>
  );
}

export function NbtViewer({ hexPayload }: { hexPayload: string }) {
  const parsed = useMemo(() => parseNbt(hexPayload), [hexPayload]);

  if (!parsed) {
    return (
      <div className="text-zinc-500 text-xs px-2 py-1">
        No NBT data detected (payload does not start with 0x0A).
      </div>
    );
  }

  return (
    <div className="text-xs font-mono leading-5 py-1">
      <NbtNode value={parsed} depth={0} />
    </div>
  );
}
