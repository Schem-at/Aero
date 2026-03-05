export interface SliderConfig {
  type: "slider";
  min: number;
  max: number;
  step: number;
}

export interface ToggleConfig {
  type: "toggle";
}

export interface ShaderParam {
  name: string;
  control: SliderConfig | ToggleConfig;
  defaultValue: number;
}

const RESERVED_NAMES = new Set(["chunk_x", "chunk_z"]);

const PARAM_RE =
  /^\/\/\s*@param\s+(\w+)\s*:\s*(slider|toggle)(?:\(([^)]*)\))?\s*=\s*(.+)$/;

export function parseShaderParams(code: string): ShaderParam[] {
  const params: ShaderParam[] = [];
  const seen = new Set<string>();

  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(PARAM_RE);
    if (!match) continue;

    const [, name, type, args, defaultStr] = match;
    if (RESERVED_NAMES.has(name) || seen.has(name)) continue;
    seen.add(name);

    const defaultValue = type === "toggle"
      ? (defaultStr.trim() === "true" ? 1.0 : 0.0)
      : parseFloat(defaultStr.trim());

    if (type === "toggle") {
      params.push({ name, control: { type: "toggle" }, defaultValue });
    } else {
      const parts = args?.split(",").map((s) => parseFloat(s.trim())) ?? [];
      if (parts.length < 2 || parts.some(isNaN)) continue;
      const [min, max, step] = parts;
      params.push({
        name,
        control: { type: "slider", min, max, step: step ?? 1 },
        defaultValue: isNaN(defaultValue) ? min : defaultValue,
      });
    }
  }

  return params;
}
