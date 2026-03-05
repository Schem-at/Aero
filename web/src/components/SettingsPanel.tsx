import { useRef, useCallback } from "react";
import { useServerConfig, generateSubdomain } from "@/context/ServerConfigContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImagePlus, Trash2, RefreshCw } from "lucide-react";

/**
 * Resize an image file to 64x64 PNG and return a `data:image/png;base64,...` string.
 * Minecraft requires exactly 64x64 for the server list favicon.
 */
function resizeToFavicon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, 64, 64);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

export function SettingsPanel() {
  const { config, updateConfig } = useServerConfig();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUri = await resizeToFavicon(file);
        updateConfig({ favicon: dataUri });
      } catch {
        // silently ignore bad files
      }
      // reset so same file can be re-selected
      e.target.value = "";
    },
    [updateConfig]
  );

  return (
    <div className="p-4 space-y-5 overflow-y-auto">
      {/* Server List Preview */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Server List Preview
        </h3>
        <ServerListPreview
          motd={config.motd}
          version={config.version_name}
          online={0}
          max={config.max_players}
          favicon={config.favicon}
        />
      </div>

      {/* Icon */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Server Icon</label>
        <p className="text-[11px] text-muted-foreground">
          Any image — auto-resized to 64x64 PNG for Minecraft
        </p>
        <div className="flex items-center gap-3">
          <div
            onClick={() => fileRef.current?.click()}
            className="w-16 h-16 rounded-md border-2 border-dashed border-border hover:border-primary/50 cursor-pointer flex items-center justify-center bg-muted/50 transition-colors overflow-hidden flex-shrink-0"
          >
            {config.favicon ? (
              <img
                src={config.favicon}
                alt="Server icon"
                className="w-full h-full object-cover"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              className="text-xs"
            >
              <ImagePlus className="h-3 w-3" />
              {config.favicon ? "Change" : "Upload"}
            </Button>
            {config.favicon && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateConfig({ favicon: null })}
                className="text-xs text-muted-foreground"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleIconUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Subdomain */}
      <Field label="Subdomain" description="Minecraft clients connect to subdomain.domain:port">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={config.subdomain}
            onChange={(e) => {
              const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
              updateConfig({ subdomain: sanitized });
            }}
            onBlur={(e) => {
              let val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
              if (val.length < 2) val = generateSubdomain();
              if (val.length > 20) val = val.slice(0, 20);
              updateConfig({ subdomain: val });
            }}
            maxLength={20}
            className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            placeholder="brave-fox"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateConfig({ subdomain: generateSubdomain() })}
            className="text-xs flex-shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            Randomize
          </Button>
        </div>
      </Field>

      {/* Fields */}
      <Field label="MOTD" description="Message shown in the Minecraft server list">
        <input
          type="text"
          value={config.motd}
          onChange={(e) => updateConfig({ motd: e.target.value })}
          className="w-full px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="A Minecraft server"
        />
      </Field>

      <div className="flex gap-4">
        <Field label="Max Players" description="Shown in server list">
          <input
            type="number"
            value={config.max_players}
            onChange={(e) =>
              updateConfig({
                max_players: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
            min={1}
            max={1000}
            className="w-24 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
          />
        </Field>

        <Field label="Version Name" description="Shown in server list">
          <input
            type="text"
            value={config.version_name}
            onChange={(e) => updateConfig({ version_name: e.target.value })}
            className="w-40 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="WASM 1.21"
          />
        </Field>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Changes are saved to localStorage and persist across sessions.
      </p>
    </div>
  );
}

/** Mimics a Minecraft server list entry */
function ServerListPreview({
  motd,
  version,
  online,
  max,
  favicon,
}: {
  motd: string;
  version: string;
  online: number;
  max: number;
  favicon: string | null;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-[#2a2a2a]">
        {/* Icon */}
        <div className="w-[52px] h-[52px] rounded flex-shrink-0 bg-[#383838] flex items-center justify-center overflow-hidden">
          {favicon ? (
            <img
              src={favicon}
              alt=""
              className="w-full h-full"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <div className="w-8 h-8 rounded bg-[#484848]" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 font-mono">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">
              Minecraft Web Server
            </span>
            <span className="text-xs text-zinc-500 flex-shrink-0 flex items-center gap-1.5">
              {/* Signal bars */}
              <SignalBars />
            </span>
          </div>
          <div className="text-xs text-zinc-400 truncate mt-0.5">
            {motd || "\u00a0"}
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[11px] text-zinc-600">{version}</span>
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {online}/{max}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SignalBars() {
  return (
    <svg width="16" height="12" viewBox="0 0 20 16" fill="none">
      <rect x="0" y="12" width="4" height="4" rx="0.5" fill="#5ced5c" />
      <rect x="5" y="8" width="4" height="8" rx="0.5" fill="#5ced5c" />
      <rect x="10" y="4" width="4" height="12" rx="0.5" fill="#5ced5c" />
      <rect x="15" y="0" width="4" height="16" rx="0.5" fill="#5ced5c" />
    </svg>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
