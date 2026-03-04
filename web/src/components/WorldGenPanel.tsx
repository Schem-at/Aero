import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePlugins } from "@/context/PluginContext";
import { ShaderGenerator } from "@/plugins/shader-generator";
import { DEFAULT_SHADER, BLOCK_CONSTANTS } from "@/plugins/shader-generator/boilerplate";

export function WorldGenPanel() {
  const { plugins, activeGenerator, setActiveGenerator, registerPlugin } = usePlugins();
  const [shaderCode, setShaderCode] = useState(DEFAULT_SHADER);
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [showBlocks, setShowBlocks] = useState(false);
  const shaderGenRef = useRef<ShaderGenerator | null>(null);

  // Register shader plugin on mount
  useEffect(() => {
    const gen = new ShaderGenerator();
    shaderGenRef.current = gen;
    registerPlugin({
      id: "shader",
      name: "WebGPU Shader",
      worldGenerator: gen,
    });
  }, [registerPlugin]);

  const generators = plugins
    .filter((p) => p.worldGenerator)
    .map((p) => p.worldGenerator!);

  const handleGeneratorChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setActiveGenerator(e.target.value);
    },
    [setActiveGenerator]
  );

  const handleApplyShader = useCallback(async () => {
    const gen = shaderGenRef.current;
    if (!gen) return;

    try {
      if (!gen.lastError && !navigator.gpu) {
        setShaderError("WebGPU is not supported in this browser");
        return;
      }

      // Initialize if needed
      await gen.init();

      // Compile new shader
      await gen.setShaderCode(shaderCode);

      if (gen.lastError) {
        setShaderError(gen.lastError);
      } else {
        setShaderError(null);
        // Switch to shader generator if not already active
        if (activeGenerator.id !== "shader") {
          setActiveGenerator("shader");
        }
      }
    } catch (err) {
      setShaderError(err instanceof Error ? err.message : String(err));
    }
  }, [shaderCode, activeGenerator, setActiveGenerator]);

  // Parse block constants for reference display
  const blockEntries = BLOCK_CONSTANTS.trim()
    .split("\n")
    .filter((line) => line.startsWith("const "))
    .map((line) => {
      const match = line.match(/const (\w+): u32 = (\d+)u;/);
      return match ? { name: match[1], id: match[2] } : null;
    })
    .filter(Boolean) as { name: string; id: string }[];

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-auto">
      {/* Generator selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Generator:</label>
        <select
          value={activeGenerator.id}
          onChange={handleGeneratorChange}
          className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
        >
          {generators.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-2">
          Active: {activeGenerator.name}
        </span>
      </div>

      {/* Shader editor (visible when shader generator exists) */}
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">WGSL Shader Code</span>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowBlocks(!showBlocks)}
              variant="outline"
              size="sm"
            >
              {showBlocks ? "Hide" : "Show"} Block IDs
            </Button>
            <Button onClick={handleApplyShader} size="sm">
              Apply Shader
            </Button>
          </div>
        </div>

        <div className="flex gap-2 flex-1 min-h-0">
          <textarea
            value={shaderCode}
            onChange={(e) => setShaderCode(e.target.value)}
            spellCheck={false}
            className="flex-1 font-mono text-xs bg-background border border-border rounded p-2 text-foreground resize-none min-h-[200px] focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Write your WGSL generator function here..."
          />

          {showBlocks && (
            <Card className="w-56 p-2 overflow-auto text-xs font-mono shrink-0">
              <div className="font-semibold mb-1 text-muted-foreground">Block IDs</div>
              {blockEntries.map((b) => (
                <div key={b.name} className="flex justify-between py-0.5">
                  <span className="text-foreground">{b.name}</span>
                  <span className="text-muted-foreground">{b.id}</span>
                </div>
              ))}
            </Card>
          )}
        </div>

        {shaderError && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-xs font-mono text-destructive whitespace-pre-wrap">
            {shaderError}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Define <code className="bg-muted px-1 rounded">fn generate(x: i32, y: i32, z: i32) -&gt; u32</code> —
          returns a block state ID for each world position. Y ranges from -64 to 319.
          Apply the shader, then reconnect to see the new terrain.
        </div>
      </div>
    </div>
  );
}
