import { useState, useCallback } from "react";
import { useWorld } from "@/context/WorldContext";
import { Button } from "@/components/ui/button";
import { Save, Trash2, FolderOpen, Plus, X } from "lucide-react";

export function WorldPanel() {
  const {
    worlds, activeWorld, isLoaded,
    refreshWorlds, createAndLoadWorld, loadWorld, unloadWorld, saveWorld, removeWorld,
  } = useWorld();

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createAndLoadWorld(name, "plugin");
      setNewName("");
    } finally {
      setCreating(false);
    }
  }, [newName, createAndLoadWorld]);

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete world "${name}"? This cannot be undone.`)) return;
    await removeWorld(name);
  }, [removeWorld]);

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {isLoaded ? (
            <span className="text-emerald-400">
              World loaded: <span className="font-bold">{activeWorld}</span>
            </span>
          ) : (
            <span>No world loaded (chunks are ephemeral)</span>
          )}
        </div>
        {isLoaded && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={saveWorld}
              className="text-xs gap-1"
            >
              <Save className="h-3 w-3" />
              Save Now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={unloadWorld}
              className="text-xs gap-1"
            >
              <X className="h-3 w-3" />
              Unload
            </Button>
          </div>
        )}
      </div>

      {/* Create new world */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New world name..."
          className="flex-1 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded focus:outline-none focus:border-emerald-600 text-zinc-200 placeholder:text-zinc-600"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleCreate}
          disabled={!newName.trim() || creating}
          className="text-xs gap-1"
        >
          <Plus className="h-3 w-3" />
          Create & Load
        </Button>
      </div>

      {/* World list */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Saved Worlds ({worlds.length})
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshWorlds}
            className="text-xs h-6 px-2"
          >
            Refresh
          </Button>
        </div>

        {worlds.length === 0 && (
          <div className="text-xs text-zinc-600 py-4 text-center">
            No worlds saved yet. Create one above to enable persistence.
          </div>
        )}

        {worlds.map((world) => (
          <div
            key={world.name}
            className={`flex items-center justify-between px-3 py-2 rounded border text-xs ${
              activeWorld === world.name
                ? "border-emerald-700/50 bg-emerald-950/20"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className={`font-medium truncate ${
                activeWorld === world.name ? "text-emerald-400" : "text-zinc-300"
              }`}>
                {world.name}
              </div>
              <div className="text-zinc-600 text-[10px]">
                {world.lastPlayed > 0
                  ? `Last played: ${new Date(world.lastPlayed).toLocaleDateString()}`
                  : "Never played"
                }
              </div>
            </div>
            <div className="flex gap-1 ml-2">
              {activeWorld !== world.name && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadWorld(world.name)}
                  className="h-6 px-2 text-xs gap-1"
                >
                  <FolderOpen className="h-3 w-3" />
                  Load
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(world.name)}
                className="h-6 px-2 text-xs text-red-500 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="text-[10px] text-zinc-700 border-t border-zinc-800 pt-3">
        Worlds are stored in your browser's OPFS (Origin Private File System) using the Anvil region format.
        Chunks auto-save every 30 seconds. Loading a world enables chunk persistence across sessions.
      </div>
    </div>
  );
}
