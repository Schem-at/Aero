import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePlugins } from "@/context/PluginContext";
import { useWorker } from "@/context/WorkerContext";
import { ShaderGenerator } from "@/plugins/shader-generator";
import { DEFAULT_SHADER, BLOCK_CONSTANTS } from "@/plugins/shader-generator/boilerplate";
import type { ShaderParam } from "@/plugins/shader-generator/params";
import { CodeEditor } from "@/components/CodeEditor";
import {
  loadPresets,
  savePresets,
  createPreset,
  updatePreset,
  deletePreset,
  type ShaderPreset,
} from "@/lib/shader-presets";
import {
  ChevronDown,
  Save,
  Plus,
  Trash2,
  Play,
  Check,
} from "lucide-react";

type CompileStatus = "idle" | "compiling" | "success" | "error";

function formatParamName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function WorldGenPanel() {
  const { plugins, activeGenerator, setActiveGenerator, registerPlugin } = usePlugins();
  const { regenerateChunks } = useWorker();
  const [shaderCode, setShaderCode] = useState(DEFAULT_SHADER);
  const [shaderError, setShaderError] = useState<string | null>(null);
  const [showBlocks, setShowBlocks] = useState(false);
  const [shaderParams, setShaderParams] = useState<ShaderParam[]>([]);
  const [paramValues, setParamValues] = useState<Map<string, number>>(new Map());
  const shaderGenRef = useRef<ShaderGenerator | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preset state
  const [presets, setPresets] = useState<ShaderPreset[]>(() => loadPresets());
  const [activePresetId, setActivePresetId] = useState<string>("default");

  // Compile status
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const compileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapsible params
  const [paramsCollapsed, setParamsCollapsed] = useState(false);

  // Save-as dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Dropdowns
  const [showGeneratorDropdown, setShowGeneratorDropdown] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const genDropdownRef = useRef<HTMLDivElement>(null);
  const presetDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (genDropdownRef.current && !genDropdownRef.current.contains(e.target as Node)) {
        setShowGeneratorDropdown(false);
      }
      if (presetDropdownRef.current && !presetDropdownRef.current.contains(e.target as Node)) {
        setShowPresetDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus save input when dialog opens
  useEffect(() => {
    if (showSaveDialog) saveInputRef.current?.focus();
  }, [showSaveDialog]);

  // Register shader plugin on mount
  useEffect(() => {
    const gen = new ShaderGenerator();
    shaderGenRef.current = gen;

    gen.onParamsChanged = (params, values) => {
      setShaderParams([...params]);
      setParamValues(new Map(values));
    };

    registerPlugin({
      id: "shader",
      name: "WebGPU Shader",
      worldGenerator: gen,
    });

    return () => {
      gen.onParamsChanged = null;
    };
  }, [registerPlugin]);

  const generators = plugins
    .filter((p) => p.worldGenerator)
    .map((p) => p.worldGenerator!);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  // ---- Handlers ----

  const handleGeneratorChange = useCallback(
    (id: string) => {
      setActiveGenerator(id);
      setShowGeneratorDropdown(false);
    },
    [setActiveGenerator],
  );

  const handleApplyShader = useCallback(async () => {
    const gen = shaderGenRef.current;
    if (!gen) return;

    setCompileStatus("compiling");
    if (compileTimerRef.current) clearTimeout(compileTimerRef.current);

    try {
      if (!navigator.gpu) {
        setShaderError("WebGPU is not supported in this browser");
        setCompileStatus("error");
        return;
      }

      await gen.init();
      await gen.setShaderCode(shaderCode);

      if (gen.lastError) {
        setShaderError(gen.lastError);
        setCompileStatus("error");
      } else {
        setShaderError(null);
        setCompileStatus("success");
        compileTimerRef.current = setTimeout(() => setCompileStatus("idle"), 3000);
        if (activeGenerator.id !== "shader") {
          setActiveGenerator("shader");
        }
      }
    } catch (err) {
      setShaderError(err instanceof Error ? err.message : String(err));
      setCompileStatus("error");
    }
  }, [shaderCode, activeGenerator, setActiveGenerator]);

  const handleParamChange = useCallback(
    (name: string, value: number) => {
      const gen = shaderGenRef.current;
      if (!gen) return;

      gen.setParamValue(name, value);
      setParamValues((prev) => {
        const next = new Map(prev);
        next.set(name, value);
        return next;
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        regenerateChunks();
      }, 150);
    },
    [regenerateChunks],
  );

  const handleLoadPreset = useCallback((preset: ShaderPreset) => {
    setShaderCode(preset.code);
    setActivePresetId(preset.id);
    setShowPresetDropdown(false);

    // Restore param values
    const gen = shaderGenRef.current;
    if (gen && Object.keys(preset.paramValues).length > 0) {
      for (const [k, v] of Object.entries(preset.paramValues)) {
        gen.setParamValue(k, v);
      }
    }
  }, []);

  const handleSavePreset = useCallback(() => {
    const pv: Record<string, number> = {};
    paramValues.forEach((v, k) => { pv[k] = v; });
    const next = updatePreset(presets, activePresetId, shaderCode, pv);
    setPresets(next);
  }, [presets, activePresetId, shaderCode, paramValues]);

  const handleSaveAsPreset = useCallback(() => {
    const name = saveDialogName.trim();
    if (!name) return;
    const pv: Record<string, number> = {};
    paramValues.forEach((v, k) => { pv[k] = v; });
    const next = createPreset(presets, name, shaderCode, pv);
    setPresets(next);
    // Select the newly created preset (last in list)
    setActivePresetId(next[next.length - 1].id);
    setShowSaveDialog(false);
    setSaveDialogName("");
  }, [presets, saveDialogName, shaderCode, paramValues]);

  const handleDeletePreset = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = deletePreset(presets, id);
      setPresets(next);
      if (activePresetId === id) {
        setActivePresetId("default");
        const defaultPreset = next.find((p) => p.id === "default");
        if (defaultPreset) setShaderCode(defaultPreset.code);
      }
    },
    [presets, activePresetId],
  );

  // Block IDs reference
  const blockEntries = BLOCK_CONSTANTS.trim()
    .split("\n")
    .filter((line) => line.startsWith("const "))
    .map((line) => {
      const match = line.match(/const (\w+): u32 = (\d+)u;/);
      return match ? { name: match[1], id: match[2] } : null;
    })
    .filter(Boolean) as { name: string; id: string }[];

  // Compile status config
  const statusConfig: Record<CompileStatus, { dot: string; text: string }> = {
    idle: { dot: "bg-zinc-500", text: "Ready" },
    compiling: { dot: "bg-amber-400 animate-pulse", text: "Compiling..." },
    success: { dot: "bg-emerald-400", text: "Compiled successfully" },
    error: { dot: "bg-red-400", text: "Compilation failed" },
  };

  const editorBorderColor =
    compileStatus === "success"
      ? "border-emerald-500/60"
      : compileStatus === "error"
        ? "border-red-500/60"
        : "border-border";

  return (
    <div className="flex flex-col h-full p-3 gap-2 overflow-hidden">
      {/* ---- TOOLBAR ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Generator selector */}
        <div ref={genDropdownRef} className="relative">
          <button
            onClick={() => setShowGeneratorDropdown(!showGeneratorDropdown)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors"
          >
            {activeGenerator.name}
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          {showGeneratorDropdown && (
            <div className="absolute top-full left-0 mt-1 z-20 min-w-[160px] rounded border border-border bg-card shadow-lg py-1">
              {generators.map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleGeneratorChange(g.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                    activeGenerator.id === g.id ? "text-primary font-medium" : "text-foreground"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preset selector */}
        <div ref={presetDropdownRef} className="relative">
          <button
            onClick={() => setShowPresetDropdown(!showPresetDropdown)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors max-w-[180px]"
          >
            <span className="truncate">{activePreset?.name ?? "Preset"}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          </button>
          {showPresetDropdown && (
            <div className="absolute top-full left-0 mt-1 z-20 min-w-[200px] max-w-[280px] rounded border border-border bg-card shadow-lg py-1">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleLoadPreset(p)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center justify-between gap-2 ${
                    activePresetId === p.id ? "text-primary font-medium" : "text-foreground"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {!p.builtIn && (
                    <button
                      onClick={(e) => handleDeletePreset(p.id, e)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Save */}
        <Button
          onClick={handleSavePreset}
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
        >
          <Save className="w-3 h-3" />
          Save
        </Button>

        {/* Save As */}
        <div className="relative">
          {showSaveDialog ? (
            <div className="flex items-center gap-1">
              <input
                ref={saveInputRef}
                value={saveDialogName}
                onChange={(e) => setSaveDialogName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveAsPreset();
                  if (e.key === "Escape") setShowSaveDialog(false);
                }}
                placeholder="Preset name..."
                className="h-7 px-2 text-xs rounded border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring w-32"
              />
              <Button
                onClick={handleSaveAsPreset}
                size="sm"
                className="h-7 px-2 text-xs"
              >
                <Check className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setShowSaveDialog(true)}
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
            >
              <Plus className="w-3 h-3" />
            </Button>
          )}
        </div>

        {/* Apply */}
        <Button
          onClick={handleApplyShader}
          size="sm"
          className="h-7 px-2.5 text-xs gap-1 ml-auto"
          disabled={compileStatus === "compiling"}
        >
          <Play className="w-3 h-3" />
          Apply
        </Button>

        {/* Badges */}
        {activeGenerator.id === "shader" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
            Shader Active
          </span>
        )}
        {shaderParams.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {shaderParams.length} param{shaderParams.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ---- CODE EDITOR ---- */}
      <div className="flex gap-2 flex-1 min-h-0">
        <div
          className={`flex-1 rounded border transition-colors duration-500 overflow-hidden ${editorBorderColor}`}
        >
          <CodeEditor
            value={shaderCode}
            onChange={setShaderCode}
            className="w-full h-full bg-background"
          />
        </div>

        {/* Block IDs panel */}
        <div
          className={`overflow-hidden transition-all duration-200 ${
            showBlocks ? "w-56 opacity-100" : "w-0 opacity-0"
          }`}
        >
          <Card className="h-full p-2 overflow-auto text-xs font-mono w-56">
            <div className="font-semibold mb-1 text-muted-foreground">Block IDs</div>
            {blockEntries.map((b) => (
              <div key={b.name} className="flex justify-between py-0.5">
                <span className="text-foreground">{b.name}</span>
                <span className="text-muted-foreground">{b.id}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* Blocks toggle - floating button */}
        <button
          onClick={() => setShowBlocks(!showBlocks)}
          className="self-start px-2 py-1 text-[10px] rounded border border-border bg-background hover:bg-accent transition-colors text-muted-foreground shrink-0"
        >
          {showBlocks ? "Hide" : "Blocks"}
        </button>
      </div>

      {/* ---- PARAMS ---- */}
      {shaderParams.length > 0 && (
        <Card className="shrink-0">
          <button
            onClick={() => setParamsCollapsed(!paramsCollapsed)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Parameters</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                paramsCollapsed ? "-rotate-90" : ""
              }`}
            />
          </button>
          <div
            className="grid transition-[grid-template-rows] duration-200"
            style={{ gridTemplateRows: paramsCollapsed ? "0fr" : "1fr" }}
          >
            <div className="overflow-hidden">
              <div className="px-3 pb-3 grid gap-2">
                {shaderParams.map((param) => {
                  const value = paramValues.get(param.name) ?? param.defaultValue;
                  return (
                    <div key={param.name} className="flex items-center gap-3 group">
                      <label className="text-xs font-medium w-32 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors duration-150">
                        {formatParamName(param.name)}
                      </label>
                      {param.control.type === "slider" ? (
                        <>
                          <input
                            type="range"
                            min={param.control.min}
                            max={param.control.max}
                            step={param.control.step}
                            value={value}
                            onChange={(e) =>
                              handleParamChange(param.name, parseFloat(e.target.value))
                            }
                            className="flex-1 h-1.5 accent-primary"
                          />
                          <span className="text-xs text-muted-foreground w-14 text-right font-mono">
                            {value % 1 === 0 ? value : value.toFixed(3)}
                          </span>
                        </>
                      ) : (
                        <button
                          onClick={() =>
                            handleParamChange(param.name, value > 0.5 ? 0 : 1)
                          }
                          className={`px-2 py-0.5 text-xs rounded border transition-all duration-150 ${
                            value > 0.5
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border"
                          }`}
                        >
                          {value > 0.5 ? "ON" : "OFF"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Shader error */}
      {shaderError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-xs font-mono text-destructive whitespace-pre-wrap shrink-0 max-h-24 overflow-auto">
          {shaderError}
        </div>
      )}

      {/* ---- STATUS BAR ---- */}
      <div className="flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusConfig[compileStatus].dot}`} />
          <span className="text-muted-foreground">{statusConfig[compileStatus].text}</span>
        </div>
        <span className="text-muted-foreground/60">
          <code className="text-[10px]">fn generate(x, y, z) → u32</code>
        </span>
      </div>
    </div>
  );
}
