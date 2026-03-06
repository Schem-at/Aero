import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ServerConsole } from "@/components/ServerConsole";
import { ChatPanel } from "@/components/ChatPanel";
import { PacketInspector } from "@/components/PacketInspector";
import { StatsPanel } from "@/components/StatsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { WorldGenPanel } from "@/components/WorldGenPanel";
import { WorldPanel } from "@/components/WorldPanel";

type Tab = "console" | "chat" | "packets" | "stats" | "worldgen" | "worlds" | "settings";

const tabs: { id: Tab; label: string }[] = [
  { id: "console", label: "Console" },
  { id: "chat", label: "Chat" },
  { id: "packets", label: "Packets" },
  { id: "stats", label: "Stats" },
  { id: "worldgen", label: "WorldGen" },
  { id: "worlds", label: "Worlds" },
  { id: "settings", label: "Settings" },
];

export function DevTools() {
  const [active, setActive] = useState<Tab>("console");

  return (
    <Card className="flex flex-col flex-1 min-h-0 p-0 overflow-hidden">
      <div className="flex items-center border-b border-border overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-medium uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 ${
              active === tab.id
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {active === "console" && <ServerConsole />}
        {active === "chat" && <ChatPanel />}
        {active === "packets" && <PacketInspector />}
        {active === "stats" && <StatsPanel />}
        {active === "worldgen" && <WorldGenPanel />}
        {active === "worlds" && <WorldPanel />}
        {active === "settings" && <SettingsPanel />}
      </div>
    </Card>
  );
}
