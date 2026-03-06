import type { MinecraftData, GeneratorResult, Config } from "../types.js";
import { fileHeader } from "./index.js";

interface BlockState {
  name: string;
  type: string;
  num_values: number;
  values?: string[];
}

interface BlockWithStates {
  id: number;
  name: string;
  minStateId: number;
  maxStateId: number;
  defaultState: number;
  states: BlockState[];
}

/**
 * Given a block's state definitions and an offset from minStateId,
 * compute the property values for that offset.
 * Minecraft uses cartesian product ordering: last property varies fastest.
 */
function offsetToProperties(states: BlockState[], offset: number): [string, string][] {
  if (states.length === 0) return [];

  const props: [string, string][] = [];
  let remaining = offset;

  // Iterate from last to first (last varies fastest)
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i];
    const numValues = s.num_values;
    const valueIndex = remaining % numValues;
    remaining = Math.floor(remaining / numValues);
    const value = s.values ? s.values[valueIndex] : String(valueIndex);
    props.unshift([s.name, value]);
  }

  return props;
}

export function generateRustBlockRegistry(data: MinecraftData, config: Config): GeneratorResult {
  const header = fileHeader("rust", data.version.minecraftVersion, data.version.version);

  // Find max state ID across all blocks
  let maxStateId = 0;
  for (const block of data.blocksArray) {
    const b = block as any as BlockWithStates;
    if (b.maxStateId > maxStateId) maxStateId = b.maxStateId;
  }

  const totalStates = maxStateId + 1;

  // Build arrays for each state ID
  const names: string[] = new Array(totalStates);
  // Store properties as array of pairs per state
  const propsPerState: [string, string][][] = new Array(totalStates);

  for (const block of data.blocksArray) {
    const b = block as any as BlockWithStates;
    const mcName = `minecraft:${b.name}`;
    for (let sid = b.minStateId; sid <= b.maxStateId; sid++) {
      const offset = sid - b.minStateId;
      names[sid] = mcName;
      propsPerState[sid] = offsetToProperties(b.states, offset);
    }
  }

  // Deduplicate property strings and names
  const uniqueNames = new Map<string, number>();
  const namesList: string[] = [];
  for (const n of names) {
    if (n && !uniqueNames.has(n)) {
      uniqueNames.set(n, namesList.length);
      namesList.push(n);
    }
  }

  // Deduplicate (key, value) pairs
  const uniqueProps = new Map<string, number>();
  const propsList: [string, string][] = [];
  function propId(key: string, val: string): number {
    const k = `${key}\0${val}`;
    if (uniqueProps.has(k)) return uniqueProps.get(k)!;
    const id = propsList.length;
    uniqueProps.set(k, id);
    propsList.push([key, val]);
    return id;
  }

  // Deduplicate property arrays (sorted sequences of prop IDs)
  const uniquePropArrays = new Map<string, number>();
  const propArraysList: number[][] = [];
  function propArrayId(props: [string, string][]): number {
    const ids = props.map(([k, v]) => propId(k, v));
    const key = ids.join(",");
    if (uniquePropArrays.has(key)) return uniquePropArrays.get(key)!;
    const id = propArraysList.length;
    uniquePropArrays.set(key, id);
    propArraysList.push(ids);
    return id;
  }

  // Build state entries referencing deduplicated data
  const stateNameIdx: number[] = new Array(totalStates).fill(0);
  const statePropArrayIdx: number[] = new Array(totalStates).fill(0);

  // Add empty props array
  propArrayId([]);

  for (let sid = 0; sid < totalStates; sid++) {
    if (names[sid]) {
      stateNameIdx[sid] = uniqueNames.get(names[sid])!;
      statePropArrayIdx[sid] = propArrayId(propsPerState[sid]);
    }
  }

  // Generate Rust code
  const lines: string[] = [header, ""];
  lines.push(`/// Block state registry for Minecraft ${data.version.minecraftVersion}`);
  lines.push(`/// Total states: ${totalStates}, Unique blocks: ${namesList.length}`);
  lines.push("");

  // Block names table
  lines.push(`static BLOCK_NAMES: [&str; ${namesList.length}] = [`);
  for (const name of namesList) {
    lines.push(`    "${name}",`);
  }
  lines.push("];");
  lines.push("");

  // Property pairs table
  lines.push(`static PROP_PAIRS: [(&str, &str); ${propsList.length}] = [`);
  for (const [k, v] of propsList) {
    lines.push(`    ("${k}", "${v}"),`);
  }
  lines.push("];");
  lines.push("");

  // Property arrays table — each is a slice into PROP_PAIRS
  // Store as (start_index, length) into a flat PROP_INDICES array
  const flatPropIndices: number[] = [];
  const propArrayOffsets: [number, number][] = [];
  for (const arr of propArraysList) {
    const start = flatPropIndices.length;
    for (const idx of arr) {
      flatPropIndices.push(idx);
    }
    propArrayOffsets.push([start, arr.length]);
  }

  lines.push(`static PROP_INDICES: [u16; ${flatPropIndices.length}] = [`);
  // Write in chunks of 20 for readability
  for (let i = 0; i < flatPropIndices.length; i += 20) {
    const chunk = flatPropIndices.slice(i, i + 20);
    lines.push(`    ${chunk.join(", ")},`);
  }
  lines.push("];");
  lines.push("");

  lines.push(`static PROP_ARRAYS: [(u16, u8); ${propArrayOffsets.length}] = [`);
  for (const [start, len] of propArrayOffsets) {
    lines.push(`    (${start}, ${len}),`);
  }
  lines.push("];");
  lines.push("");

  // State entries: (name_index, prop_array_index)
  lines.push(`static BLOCK_STATES: [(u16, u16); ${totalStates}] = [`);
  for (let sid = 0; sid < totalStates; sid += 10) {
    const chunk: string[] = [];
    for (let j = sid; j < Math.min(sid + 10, totalStates); j++) {
      chunk.push(`(${stateNameIdx[j]}, ${statePropArrayIdx[j]})`);
    }
    lines.push(`    ${chunk.join(", ")},`);
  }
  lines.push("];");
  lines.push("");

  // Build a block ranges table for reverse lookup: (name, minStateId, maxStateId, states_count)
  lines.push("/// Block ranges for reverse lookup: (name_index, min_state, max_state)");
  lines.push(`static BLOCK_RANGES: [(u16, u16, u16); ${namesList.length}] = [`);
  for (const block of data.blocksArray) {
    const b = block as any as BlockWithStates;
    const mcName = `minecraft:${b.name}`;
    const nameIdx = uniqueNames.get(mcName)!;
    lines.push(`    (${nameIdx}, ${b.minStateId}, ${b.maxStateId}),`);
  }
  lines.push("];");
  lines.push("");

  // Public API
  lines.push("pub struct BlockStateEntry {");
  lines.push("    pub name: &'static str,");
  lines.push("    pub properties: Vec<(&'static str, &'static str)>,");
  lines.push("}");
  lines.push("");

  lines.push("/// Look up a block state by its numeric ID.");
  lines.push("pub fn state_to_block(state_id: u16) -> Option<BlockStateEntry> {");
  lines.push(`    if (state_id as usize) >= ${totalStates} { return None; }`);
  lines.push("    let (name_idx, prop_arr_idx) = BLOCK_STATES[state_id as usize];");
  lines.push("    let name = BLOCK_NAMES[name_idx as usize];");
  lines.push("    let (prop_start, prop_len) = PROP_ARRAYS[prop_arr_idx as usize];");
  lines.push("    let mut properties = Vec::with_capacity(prop_len as usize);");
  lines.push("    for i in 0..prop_len as usize {");
  lines.push("        let pair_idx = PROP_INDICES[prop_start as usize + i] as usize;");
  lines.push("        properties.push(PROP_PAIRS[pair_idx]);");
  lines.push("    }");
  lines.push("    Some(BlockStateEntry { name, properties })");
  lines.push("}");
  lines.push("");

  lines.push("/// Look up a block state ID from name and properties.");
  lines.push("pub fn block_to_state(name: &str, properties: &[(&str, &str)]) -> Option<u16> {");
  lines.push("    for &(name_idx, min_state, max_state) in &BLOCK_RANGES {");
  lines.push("        if BLOCK_NAMES[name_idx as usize] != name { continue; }");
  lines.push("        for sid in min_state..=max_state {");
  lines.push("            let entry = state_to_block(sid).unwrap();");
  lines.push("            if entry.properties.len() != properties.len() { continue; }");
  lines.push("            let mut matches = true;");
  lines.push("            for (k, v) in properties {");
  lines.push("                if !entry.properties.iter().any(|(ek, ev)| ek == k && ev == v) {");
  lines.push("                    matches = false;");
  lines.push("                    break;");
  lines.push("                }");
  lines.push("            }");
  lines.push("            if matches { return Some(sid); }");
  lines.push("        }");
  lines.push("        return None;");
  lines.push("    }");
  lines.push("    None");
  lines.push("}");
  lines.push("");

  // Tests
  lines.push("#[cfg(test)]");
  lines.push("mod tests {");
  lines.push("    use super::*;");
  lines.push("");
  lines.push("    #[test]");
  lines.push("    fn test_air_is_zero() {");
  lines.push('        let entry = state_to_block(0).unwrap();');
  lines.push('        assert_eq!(entry.name, "minecraft:air");');
  lines.push("        assert!(entry.properties.is_empty());");
  lines.push("    }");
  lines.push("");
  lines.push("    #[test]");
  lines.push("    fn test_stone_is_one() {");
  lines.push('        let entry = state_to_block(1).unwrap();');
  lines.push('        assert_eq!(entry.name, "minecraft:stone");');
  lines.push("        assert!(entry.properties.is_empty());");
  lines.push("    }");
  lines.push("");
  lines.push("    #[test]");
  lines.push("    fn test_block_with_properties() {");
  lines.push("        // oak_log axis=y is default state (137), axis=x is 136");
  lines.push('        let entry = state_to_block(136).unwrap();');
  lines.push('        assert_eq!(entry.name, "minecraft:oak_log");');
  lines.push('        assert!(entry.properties.contains(&("axis", "x")));');
  lines.push("");
  lines.push('        let entry = state_to_block(137).unwrap();');
  lines.push('        assert_eq!(entry.name, "minecraft:oak_log");');
  lines.push('        assert!(entry.properties.contains(&("axis", "y")));');
  lines.push("    }");
  lines.push("");
  lines.push("    #[test]");
  lines.push("    fn test_reverse_lookup() {");
  lines.push('        let sid = block_to_state("minecraft:stone", &[]).unwrap();');
  lines.push("        assert_eq!(sid, 1);");
  lines.push("");
  lines.push('        let sid = block_to_state("minecraft:oak_log", &[("axis", "x")]).unwrap();');
  lines.push("        assert_eq!(sid, 136);");
  lines.push("    }");
  lines.push("");
  lines.push("    #[test]");
  lines.push("    fn test_out_of_range() {");
  lines.push("        assert!(state_to_block(65535).is_none());");
  lines.push("    }");
  lines.push("}");
  lines.push("");

  return {
    path: (config.outputs as any).rustBlockRegistry,
    content: lines.join("\n"),
    name: "rust-block-registry",
  };
}
