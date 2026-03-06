/// Anvil chunk NBT serialization/deserialization.
///
/// Converts between flat u16 block state arrays (24 sections × 16³ = 98304 entries)
/// and Anvil chunk NBT format with palettized sections.

use crate::block_registry;
use crate::compression;
use crate::nbt::{NbtReader, NbtValue, NbtWriter};
use super::AnvilError;
use super::region;

const SECTION_VOLUME: usize = 16 * 16 * 16; // 4096
const NUM_SECTIONS: usize = 24; // Y = -64 to 319
const TOTAL_BLOCKS: usize = SECTION_VOLUME * NUM_SECTIONS; // 98304
const MIN_SECTION_Y: i32 = -4; // -64 / 16

/// Serialize a chunk's block states into Anvil NBT format.
/// `block_states` must have exactly 98304 entries (24 sections × 4096 blocks).
/// Returns Java NBT bytes (uncompressed).
pub fn serialize_chunk(cx: i32, cz: i32, block_states: &[u16]) -> Vec<u8> {
    assert_eq!(block_states.len(), TOTAL_BLOCKS);

    let mut w = NbtWriter::new_java();
    w.int("DataVersion", 4325); // 1.21.11
    w.int("xPos", cx);
    w.int("yPos", MIN_SECTION_Y);
    w.int("zPos", cz);
    w.string("Status", "minecraft:full");

    // Sections
    w.begin_list("sections", 0x0A, NUM_SECTIONS as i32);
    for section_idx in 0..NUM_SECTIONS {
        let section_y = MIN_SECTION_Y + section_idx as i32;
        let offset = section_idx * SECTION_VOLUME;
        let section_blocks = &block_states[offset..offset + SECTION_VOLUME];

        serialize_section(&mut w, section_y, section_blocks);
    }

    w.end_compound(); // close root
    // NbtWriter::finish writes TAG_END for root, but we already wrote it via the list.
    // Actually, new_java starts a root compound, and finish() closes it.
    w.finish()
}

fn serialize_section(w: &mut NbtWriter, y: i32, blocks: &[u16]) {
    // Build palette
    let mut palette: Vec<u16> = Vec::new();
    let mut palette_map: std::collections::HashMap<u16, usize> = std::collections::HashMap::new();
    let mut indices: Vec<usize> = Vec::with_capacity(SECTION_VOLUME);

    for &state_id in blocks {
        let idx = if let Some(&idx) = palette_map.get(&state_id) {
            idx
        } else {
            let idx = palette.len();
            palette_map.insert(state_id, idx);
            palette.push(state_id);
            idx
        };
        indices.push(idx);
    }

    w.byte("Y", y as i8);

    // block_states compound
    w.begin_compound("block_states");

    // palette list
    w.begin_list("palette", 0x0A, palette.len() as i32);
    for &state_id in &palette {
        if let Some(entry) = block_registry::state_to_block(state_id) {
            w.string("Name", entry.name);
            if !entry.properties.is_empty() {
                w.begin_compound("Properties");
                for (key, val) in &entry.properties {
                    w.string(key, val);
                }
                w.end_compound();
            }
        } else {
            w.string("Name", "minecraft:air");
        }
        w.end_compound(); // end palette entry
    }

    // data long array (packed block indices)
    if palette.len() > 1 {
        let bpe = bits_per_entry(palette.len());
        let longs = pack_indices(&indices, bpe);
        w.long_array("data", &longs);
    }
    // If palette has only 1 entry, no data array needed (implicit all-same)

    w.end_compound(); // end block_states

    w.end_compound(); // end section
}

/// Deserialize a chunk from Java NBT bytes (uncompressed).
/// Returns (cx, cz, block_states) where block_states has 98304 entries.
pub fn deserialize_chunk(data: &[u8]) -> Result<(i32, i32, Vec<u16>), AnvilError> {
    let (_, root) = NbtReader::parse_java(data)?;

    let cx = root.get("xPos").and_then(|v| v.as_int())
        .ok_or_else(|| AnvilError::InvalidFormat("missing xPos".into()))?;
    let cz = root.get("zPos").and_then(|v| v.as_int())
        .ok_or_else(|| AnvilError::InvalidFormat("missing zPos".into()))?;

    let sections = root.get("sections").and_then(|v| v.as_list())
        .ok_or_else(|| AnvilError::InvalidFormat("missing sections".into()))?;

    let mut block_states = vec![0u16; TOTAL_BLOCKS];

    for section in sections {
        let section_y = section.get("Y").and_then(|v| v.as_byte())
            .ok_or_else(|| AnvilError::InvalidFormat("missing section Y".into()))? as i32;

        let section_idx = (section_y - MIN_SECTION_Y) as usize;
        if section_idx >= NUM_SECTIONS { continue; }

        let offset = section_idx * SECTION_VOLUME;

        if let Some(bs) = section.get("block_states") {
            let palette = bs.get("palette").and_then(|v| v.as_list())
                .ok_or_else(|| AnvilError::InvalidFormat("missing palette".into()))?;

            // Resolve palette to state IDs
            let palette_ids: Vec<u16> = palette.iter().map(|entry| {
                resolve_palette_entry(entry)
            }).collect();

            if palette_ids.len() == 1 {
                // Single-entry palette: fill entire section
                let state_id = palette_ids[0];
                for i in 0..SECTION_VOLUME {
                    block_states[offset + i] = state_id;
                }
            } else if let Some(data_arr) = bs.get("data").and_then(|v| v.as_long_array()) {
                let bpe = bits_per_entry(palette_ids.len());
                let indices = unpack_indices(data_arr, bpe, SECTION_VOLUME);
                for (i, &idx) in indices.iter().enumerate() {
                    let state_id = if idx < palette_ids.len() {
                        palette_ids[idx]
                    } else {
                        0 // fallback to air
                    };
                    block_states[offset + i] = state_id;
                }
            }
        }
    }

    Ok((cx, cz, block_states))
}

/// Prepare a chunk for writing into a region file.
/// Returns (compressed_entry_bytes, sector_count).
pub fn prepare_chunk_for_region(cx: i32, cz: i32, block_states: &[u16]) -> (Vec<u8>, u8) {
    let nbt_bytes = serialize_chunk(cx, cz, block_states);
    let compressed = compression::zlib_compress(&nbt_bytes);
    let sector_count = region::sectors_needed(compressed.len());
    let entry = region::build_chunk_entry(&compressed);
    (entry, sector_count)
}

/// Parse a chunk from a region file entry (raw bytes from region file at chunk offset).
/// Returns (cx, cz, block_states).
pub fn parse_chunk_from_region(entry_data: &[u8]) -> Result<(i32, i32, Vec<u16>), AnvilError> {
    let nbt_bytes = region::parse_chunk_entry(entry_data)?;
    deserialize_chunk(&nbt_bytes)
}

fn resolve_palette_entry(entry: &NbtValue) -> u16 {
    let name = entry.get("Name").and_then(|v| v.as_string()).unwrap_or("minecraft:air");

    if let Some(props_val) = entry.get("Properties") {
        if let Some(props) = props_val.as_compound() {
            let prop_pairs: Vec<(&str, &str)> = props.iter()
                .filter_map(|(k, v)| v.as_string().map(|s| (k.as_str(), s)))
                .collect();
            if let Some(id) = block_registry::block_to_state(name, &prop_pairs) {
                return id;
            }
        }
    }

    // Try without properties (default state)
    block_registry::block_to_state(name, &[]).unwrap_or(0)
}

/// Calculate bits per entry for a palette of given size.
/// Minimum 4 bits per Minecraft spec.
fn bits_per_entry(palette_size: usize) -> usize {
    if palette_size <= 1 { return 0; }
    let raw = (usize::BITS - (palette_size - 1).leading_zeros()) as usize;
    std::cmp::max(4, raw)
}

/// Pack block indices into a long array. Entries do NOT span longs (Minecraft 1.16+ format).
fn pack_indices(indices: &[usize], bpe: usize) -> Vec<i64> {
    if bpe == 0 { return vec![]; }

    let entries_per_long = 64 / bpe;
    let num_longs = (indices.len() + entries_per_long - 1) / entries_per_long;
    let mask = (1u64 << bpe) - 1;
    let mut longs = vec![0i64; num_longs];

    for (i, &idx) in indices.iter().enumerate() {
        let long_index = i / entries_per_long;
        let bit_offset = (i % entries_per_long) * bpe;
        longs[long_index] |= ((idx as u64 & mask) << bit_offset) as i64;
    }

    longs
}

/// Unpack block indices from a long array. Entries do NOT span longs.
fn unpack_indices(longs: &[i64], bpe: usize, count: usize) -> Vec<usize> {
    if bpe == 0 { return vec![0; count]; }

    let entries_per_long = 64 / bpe;
    let mask = (1u64 << bpe) - 1;
    let mut indices = Vec::with_capacity(count);

    for i in 0..count {
        let long_index = i / entries_per_long;
        let bit_offset = (i % entries_per_long) * bpe;
        if long_index < longs.len() {
            let val = ((longs[long_index] as u64) >> bit_offset) & mask;
            indices.push(val as usize);
        } else {
            indices.push(0);
        }
    }

    indices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bits_per_entry() {
        assert_eq!(bits_per_entry(1), 0);
        assert_eq!(bits_per_entry(2), 4); // min 4
        assert_eq!(bits_per_entry(16), 4);
        assert_eq!(bits_per_entry(17), 5);
        assert_eq!(bits_per_entry(32), 5);
        assert_eq!(bits_per_entry(33), 6);
    }

    #[test]
    fn test_pack_unpack_roundtrip() {
        let indices: Vec<usize> = (0..4096).map(|i| i % 16).collect();
        let bpe = 4;
        let packed = pack_indices(&indices, bpe);
        let unpacked = unpack_indices(&packed, bpe, 4096);
        assert_eq!(indices, unpacked);
    }

    #[test]
    fn test_pack_unpack_5bit() {
        let indices: Vec<usize> = (0..4096).map(|i| i % 25).collect();
        let bpe = 5;
        let packed = pack_indices(&indices, bpe);
        let unpacked = unpack_indices(&packed, bpe, 4096);
        assert_eq!(indices, unpacked);
    }

    #[test]
    fn test_serialize_deserialize_empty_chunk() {
        // All air
        let block_states = vec![0u16; TOTAL_BLOCKS];
        let nbt = serialize_chunk(0, 0, &block_states);
        let (cx, cz, result) = deserialize_chunk(&nbt).unwrap();
        assert_eq!(cx, 0);
        assert_eq!(cz, 0);
        assert_eq!(result, block_states);
    }

    #[test]
    fn test_serialize_deserialize_flat_chunk() {
        let mut block_states = vec![0u16; TOTAL_BLOCKS];
        // Fill section at y=4 (index 8, which is y_section=4, actual Y=0..15) with stone (state 1)
        let section_idx = (4 - MIN_SECTION_Y) as usize;
        for i in 0..SECTION_VOLUME {
            block_states[section_idx * SECTION_VOLUME + i] = 1; // stone
        }

        let nbt = serialize_chunk(5, -3, &block_states);
        let (cx, cz, result) = deserialize_chunk(&nbt).unwrap();
        assert_eq!(cx, 5);
        assert_eq!(cz, -3);
        assert_eq!(result, block_states);
    }

    #[test]
    fn test_serialize_deserialize_multi_block_section() {
        let mut block_states = vec![0u16; TOTAL_BLOCKS];
        // Mix of blocks in one section
        let section_idx = (0 - MIN_SECTION_Y) as usize;
        let offset = section_idx * SECTION_VOLUME;
        for y in 0..16 {
            for z in 0..16 {
                for x in 0..16 {
                    let i = y * 256 + z * 16 + x;
                    block_states[offset + i] = match y {
                        0..=3 => 1,   // stone
                        4..=6 => 9,   // grass_block (snowy=false)
                        _ => 0,       // air
                    };
                }
            }
        }

        let nbt = serialize_chunk(10, 20, &block_states);
        let (cx, cz, result) = deserialize_chunk(&nbt).unwrap();
        assert_eq!(cx, 10);
        assert_eq!(cz, 20);
        assert_eq!(result, block_states);
    }

    #[test]
    fn test_prepare_and_parse_region_entry() {
        let mut block_states = vec![0u16; TOTAL_BLOCKS];
        block_states[0] = 1; // one stone block

        let (entry, sector_count) = prepare_chunk_for_region(3, 7, &block_states);
        assert!(sector_count > 0);
        assert_eq!(entry.len() % 4096, 0);

        let (cx, cz, result) = parse_chunk_from_region(&entry).unwrap();
        assert_eq!(cx, 3);
        assert_eq!(cz, 7);
        assert_eq!(result, block_states);
    }

    #[test]
    fn test_negative_coordinates() {
        let block_states = vec![0u16; TOTAL_BLOCKS];
        let nbt = serialize_chunk(-10, -20, &block_states);
        let (cx, cz, _) = deserialize_chunk(&nbt).unwrap();
        assert_eq!(cx, -10);
        assert_eq!(cz, -20);
    }
}
