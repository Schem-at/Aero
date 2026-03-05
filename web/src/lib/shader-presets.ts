import { DEFAULT_SHADER } from "@/plugins/shader-generator/boilerplate";

export interface ShaderPreset {
  id: string;
  name: string;
  code: string;
  paramValues: Record<string, number>;
  builtIn: boolean;
  updatedAt: number;
}

const STORAGE_KEY = "aero-shader-presets";

const BUILTIN_ID = "default";

function createBuiltIn(): ShaderPreset {
  return {
    id: BUILTIN_ID,
    name: "Terrain (Default)",
    code: DEFAULT_SHADER,
    paramValues: {},
    builtIn: true,
    updatedAt: Date.now(),
  };
}

export function loadPresets(): ShaderPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ShaderPreset[] = JSON.parse(raw);
      // Ensure built-in exists at position 0
      const hasBuiltIn = parsed.some((p) => p.id === BUILTIN_ID);
      if (!hasBuiltIn) parsed.unshift(createBuiltIn());
      return parsed;
    }
  } catch { /* ignore */ }
  return [createBuiltIn()];
}

export function savePresets(presets: ShaderPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createPreset(
  presets: ShaderPreset[],
  name: string,
  code: string,
  paramValues: Record<string, number>,
): ShaderPreset[] {
  const preset: ShaderPreset = {
    id: Date.now().toString(36),
    name,
    code,
    paramValues,
    builtIn: false,
    updatedAt: Date.now(),
  };
  const next = [...presets, preset];
  savePresets(next);
  return next;
}

export function updatePreset(
  presets: ShaderPreset[],
  id: string,
  code: string,
  paramValues: Record<string, number>,
): ShaderPreset[] {
  const next = presets.map((p) =>
    p.id === id ? { ...p, code, paramValues, updatedAt: Date.now() } : p,
  );
  savePresets(next);
  return next;
}

export function deletePreset(presets: ShaderPreset[], id: string): ShaderPreset[] {
  const next = presets.filter((p) => p.id !== id || p.builtIn);
  savePresets(next);
  return next;
}
