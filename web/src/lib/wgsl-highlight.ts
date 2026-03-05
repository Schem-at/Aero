/** WGSL syntax highlighter — returns HTML with <span class="tok-*"> tags. */

const KEYWORDS = new Set([
  "fn", "var", "let", "const", "if", "else", "for", "return",
  "switch", "case", "default", "struct", "loop", "break", "continue", "while",
]);

const TYPES = new Set([
  "u32", "i32", "f32", "bool", "vec2", "vec3", "vec4", "array",
]);

const BUILTINS = new Set([
  "floor", "ceil", "round", "fract", "abs", "max", "min", "clamp",
  "mix", "step", "dot", "sqrt", "sin", "cos", "pow",
]);

const BLOCK_NAMES = new Set([
  "AIR", "STONE", "GRANITE", "POLISHED_GRANITE", "DIORITE", "POLISHED_DIORITE",
  "ANDESITE", "POLISHED_ANDESITE", "GRASS_BLOCK", "DIRT", "COARSE_DIRT",
  "COBBLESTONE", "OAK_PLANKS", "BEDROCK", "WATER", "LAVA", "SAND", "GRAVEL",
  "GOLD_ORE", "IRON_ORE", "COAL_ORE", "OAK_LOG", "OAK_LEAVES", "GLASS",
  "LAPIS_ORE", "LAPIS_BLOCK", "SANDSTONE", "GOLD_BLOCK", "IRON_BLOCK",
  "OBSIDIAN", "DIAMOND_ORE", "DIAMOND_BLOCK", "ICE", "SNOW_BLOCK", "CLAY",
  "NETHERRACK", "SOUL_SAND", "GLOWSTONE", "EMERALD_ORE", "EMERALD_BLOCK",
  "DEEPSLATE", "WHITE_CONCRETE", "ORANGE_CONCRETE", "MAGENTA_CONCRETE",
  "LIGHT_BLUE_CONCRETE", "YELLOW_CONCRETE", "LIME_CONCRETE", "PINK_CONCRETE",
  "GRAY_CONCRETE", "LIGHT_GRAY_CONCRETE", "CYAN_CONCRETE", "PURPLE_CONCRETE",
  "BLUE_CONCRETE", "BROWN_CONCRETE", "GREEN_CONCRETE", "RED_CONCRETE",
  "BLACK_CONCRETE",
]);

const DECORATOR_RE = /^@\w+/;
const NUMBER_RE = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[iu]?/;
const IDENT_RE = /^[a-zA-Z_]\w*/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);

    // Decorator (@group, @binding, etc.)
    const decMatch = rest.match(DECORATOR_RE);
    if (decMatch) {
      out += `<span class="tok-decorator">${esc(decMatch[0])}</span>`;
      i += decMatch[0].length;
      continue;
    }

    // Number
    const numMatch = rest.match(NUMBER_RE);
    if (numMatch && numMatch[0].length > 0 && (i === 0 || !/[a-zA-Z_]/.test(code[i - 1]))) {
      out += `<span class="tok-number">${esc(numMatch[0])}</span>`;
      i += numMatch[0].length;
      continue;
    }

    // Identifier (keyword / type / builtin / block / plain)
    const idMatch = rest.match(IDENT_RE);
    if (idMatch) {
      const word = idMatch[0];
      if (KEYWORDS.has(word)) {
        out += `<span class="tok-keyword">${esc(word)}</span>`;
      } else if (TYPES.has(word)) {
        out += `<span class="tok-type">${esc(word)}</span>`;
      } else if (BUILTINS.has(word)) {
        out += `<span class="tok-builtin">${esc(word)}</span>`;
      } else if (BLOCK_NAMES.has(word)) {
        out += `<span class="tok-block">${esc(word)}</span>`;
      } else {
        out += esc(word);
      }
      i += word.length;
      continue;
    }

    // Plain char
    out += esc(code[i]);
    i++;
  }
  return out;
}

export function highlightWGSL(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      // @param comment — whole line
      if (/^\s*\/\/\s*@param\b/.test(line)) {
        return `<span class="tok-param">${esc(line)}</span>`;
      }

      // Regular comment
      const commentIdx = line.indexOf("//");
      if (commentIdx !== -1) {
        const before = line.slice(0, commentIdx);
        const comment = line.slice(commentIdx);
        return highlightCode(before) + `<span class="tok-comment">${esc(comment)}</span>`;
      }

      return highlightCode(line);
    })
    .join("\n");
}
