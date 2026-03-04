import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ServerConsole } from "@/components/ServerConsole";
import { PacketInspector } from "@/components/PacketInspector";
import { StatsPanel } from "@/components/StatsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";

type Tab = "console" | "packets" | "stats" | "settings";

const tabs: { id: Tab; label: string }[] = [
  { id: "console", label: "Console" },
  { id: "packets", label: "Packets" },
  { id: "stats", label: "Stats" },
  { id: "settings", label: "Settings" },
];

export function DevTools() {
  const [active, setActive] = useState<Tab>("console");

  return (
    <Card className="flex flex-col flex-1 min-h-0 p-0 overflow-hidden">
      <div className="flex items-center border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
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
        {active === "packets" && <PacketInspector />}
        {active === "stats" && <StatsPanel />}
        {active === "settings" && <SettingsPanel />}
      </div>
    </Card>
  );
}
