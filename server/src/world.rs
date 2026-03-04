/// Builds all Play state initialization packets for spawning a player
/// on a 16x16 red concrete platform at Y=64.

use crate::compression::compress_packet;
use crate::protocol::types::{write_string, write_varint};

/// Build all Play initialization packets as concatenated compressed bytes.
pub fn build_play_packets(entity_id: i32, threshold: i32) -> Vec<u8> {
    let mut result = Vec::new();

    // 1. Login Play (0x30)
    result.extend_from_slice(&compress_packet(0x30, &build_login_play(entity_id), threshold));

    // 2. Game Event (0x26) — Start waiting for level chunks (event=13)
    result.extend_from_slice(&compress_packet(0x26, &build_game_event(13, 0.0), threshold));

    // 3. Set Default Spawn Position (0x5F)
    result.extend_from_slice(&compress_packet(0x5F, &build_set_default_spawn(), threshold));

    // 4. Update View Position (0x5C) — Set Center Chunk
    result.extend_from_slice(&compress_packet(0x5C, &build_update_view_position(), threshold));

    // 5. Chunk Batch Start (0x0C) — empty payload
    result.extend_from_slice(&compress_packet(0x0C, &[], threshold));

    // 6. Chunk Data and Update Light (0x2C) — 5x5 grid centered on (0,0)
    let mut chunk_count = 0;
    for cx in -2..=2i32 {
        for cz in -2..=2i32 {
            let has_platform = cx == 0 && cz == 0;
            result.extend_from_slice(&compress_packet(
                0x2C,
                &build_chunk_data_at(cx, cz, has_platform),
                threshold,
            ));
            chunk_count += 1;
        }
    }

    // 7. Chunk Batch Finished (0x0B)
    result.extend_from_slice(&compress_packet(0x0B, &build_chunk_batch_finished(chunk_count), threshold));

    // 8. Synchronize Player Position (0x46)
    result.extend_from_slice(&compress_packet(0x46, &build_sync_player_position(), threshold));

    result
}

fn build_login_play(entity_id: i32) -> Vec<u8> {
    let mut p = Vec::new();

    // Entity ID (i32)
    p.extend_from_slice(&entity_id.to_be_bytes());
    // Is Hardcore (bool)
    p.push(0);
    // Dimension Count (VarInt) + dimension names
    p.extend_from_slice(&write_varint(1));
    p.extend_from_slice(&write_string("minecraft:overworld"));
    // Max Players (VarInt)
    p.extend_from_slice(&write_varint(20));
    // View Distance (VarInt)
    p.extend_from_slice(&write_varint(2));
    // Simulation Distance (VarInt)
    p.extend_from_slice(&write_varint(2));
    // Reduced Debug Info (bool)
    p.push(0);
    // Enable Respawn Screen (bool)
    p.push(1);
    // Do Limited Crafting (bool)
    p.push(0);

    // Spawn Info:
    // Dimension Type (VarInt — index into dimension_type registry)
    p.extend_from_slice(&write_varint(0));
    // Dimension Name (String)
    p.extend_from_slice(&write_string("minecraft:overworld"));
    // Hashed Seed (i64)
    p.extend_from_slice(&0i64.to_be_bytes());
    // Game Mode (i8) — 1 = Creative
    p.push(1);
    // Previous Game Mode (u8) — 0xFF = undefined
    p.push(0xFF);
    // Is Debug (bool)
    p.push(0);
    // Is Flat (bool)
    p.push(1);
    // Has Death Location (bool) — None
    p.push(0);
    // Portal Cooldown (VarInt)
    p.extend_from_slice(&write_varint(0));
    // Sea Level (VarInt)
    p.extend_from_slice(&write_varint(63));
    // Enforces Secure Chat (bool)
    p.push(0);

    p
}

fn build_game_event(event: u8, value: f32) -> Vec<u8> {
    let mut p = Vec::new();
    p.push(event);
    p.extend_from_slice(&value.to_be_bytes());
    p
}

fn encode_position(x: i32, y: i32, z: i32) -> i64 {
    ((x as i64 & 0x3FFFFFF) << 38) | ((z as i64 & 0x3FFFFFF) << 12) | (y as i64 & 0xFFF)
}

/// Set Default Spawn Position (0x5F) — protocol 774 format: RespawnData
/// RespawnData = GlobalPos { dimensionName: String, location: Position } + yaw: f32 + pitch: f32
fn build_set_default_spawn() -> Vec<u8> {
    let mut p = Vec::new();
    // GlobalPos
    p.extend_from_slice(&write_string("minecraft:overworld")); // dimensionName
    let pos = encode_position(8, 65, 8);
    p.extend_from_slice(&pos.to_be_bytes()); // location
    // Rotation
    p.extend_from_slice(&0.0f32.to_be_bytes()); // yaw
    p.extend_from_slice(&0.0f32.to_be_bytes()); // pitch
    p
}

fn build_update_view_position() -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(0)); // chunk_x
    p.extend_from_slice(&write_varint(0)); // chunk_z
    p
}

fn build_chunk_data_at(cx: i32, cz: i32, has_platform: bool) -> Vec<u8> {
    let mut p = Vec::new();

    // Chunk X, Z (i32)
    p.extend_from_slice(&cx.to_be_bytes());
    p.extend_from_slice(&cz.to_be_bytes());

    // Heightmaps
    let heightmap_value = if has_platform { 129 } else { 0 };
    p.extend_from_slice(&build_heightmaps(heightmap_value));

    // Chunk section data
    let section_data = build_chunk_sections(has_platform);
    p.extend_from_slice(&write_varint(section_data.len() as i32));
    p.extend_from_slice(&section_data);

    // Block entities: count = 0
    p.extend_from_slice(&write_varint(0));

    // Light data
    p.extend_from_slice(&build_light_data());

    p
}

/// Build heightmaps in protocol 774 array format.
/// Format: VarInt count + entries of {VarInt type, VarInt data_count, i64[data_count]}
/// Types: 1=WORLD_SURFACE, 4=MOTION_BLOCKING
fn build_heightmaps(value: u64) -> Vec<u8> {
    // 9 bits per entry, 7 entries per long → ceil(256/7) = 37 longs per heightmap
    let heightmap_longs = pack_heightmap_longs(value, 256, 9);

    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(2)); // 2 heightmap entries

    // WORLD_SURFACE (type=1)
    p.extend_from_slice(&write_varint(1));
    p.extend_from_slice(&write_varint(heightmap_longs.len() as i32));
    for &val in &heightmap_longs {
        p.extend_from_slice(&val.to_be_bytes());
    }

    // MOTION_BLOCKING (type=4)
    p.extend_from_slice(&write_varint(4));
    p.extend_from_slice(&write_varint(heightmap_longs.len() as i32));
    for &val in &heightmap_longs {
        p.extend_from_slice(&val.to_be_bytes());
    }

    p
}

/// Pack `count` values of `value` at `bits_per_entry` into i64 array.
fn pack_heightmap_longs(value: u64, count: usize, bits_per_entry: usize) -> Vec<i64> {
    let entries_per_long = 64 / bits_per_entry;
    let num_longs = (count + entries_per_long - 1) / entries_per_long;
    let mask = (1u64 << bits_per_entry) - 1;
    let val = value & mask;

    let mut longs = Vec::with_capacity(num_longs);
    let mut remaining = count;

    for _ in 0..num_longs {
        let mut long_val: u64 = 0;
        let entries_this_long = remaining.min(entries_per_long);
        for j in 0..entries_this_long {
            long_val |= val << (j * bits_per_entry);
        }
        longs.push(long_val as i64);
        remaining -= entries_this_long;
    }

    longs
}

/// Build all 24 chunk sections (Y=-64 to Y=319, 16 blocks each).
/// If has_platform, section 8 (Y=64..79) has the 16x16 red concrete platform at Y=64.
fn build_chunk_sections(has_platform: bool) -> Vec<u8> {
    let mut data = Vec::new();
    for section_idx in 0..24 {
        if has_platform && section_idx == 8 {
            data.extend_from_slice(&build_platform_section());
        } else {
            data.extend_from_slice(&build_empty_section());
        }
    }
    data
}

fn build_empty_section() -> Vec<u8> {
    let mut s = Vec::new();
    // Block count
    s.extend_from_slice(&0u16.to_be_bytes());
    // Block palette: single-valued (bpe=0), palette=0 (air)
    s.push(0); // bits_per_entry
    s.extend_from_slice(&write_varint(0)); // palette value (air)
    // No data array length — removed in 1.21.5+ (protocol 770+)
    // Biome palette: single-valued (bpe=0), palette=0 (plains)
    s.push(0); // bits_per_entry
    s.extend_from_slice(&write_varint(0)); // palette value (plains)
    // No data array length
    s
}

/// Red concrete block state ID: 14842 (from PrismarineJS 1.21.9)
const RED_CONCRETE: i32 = 14842;

fn build_platform_section() -> Vec<u8> {
    let mut s = Vec::new();

    // Block count: 256 (16x16 layer)
    s.extend_from_slice(&256u16.to_be_bytes());

    // Indirect palette with 4 bits per entry
    s.push(4); // bits_per_entry
    // Palette: 2 entries
    s.extend_from_slice(&write_varint(2));
    s.extend_from_slice(&write_varint(0)); // palette[0] = air
    s.extend_from_slice(&write_varint(RED_CONCRETE)); // palette[1] = red_concrete

    // Data: 4096 entries × 4 bits = 16384 bits = 256 longs
    // No data array length VarInt — removed in 1.21.5+ (protocol 770+)
    // Client computes: ceil(4096 / floor(64/4)) = 256 longs

    // Pack block data: 16 entries per i64 at 4 bits each
    // Y=0 layer (first 256 entries) = palette index 1 (red_concrete)
    // Y=1..15 layers (remaining 3840 entries) = palette index 0 (air)

    // First 16 longs: all entries = 1 (0x1111_1111_1111_1111)
    for _ in 0..16 {
        s.extend_from_slice(&0x1111_1111_1111_1111u64.to_be_bytes());
    }
    // Remaining 240 longs: all air (0)
    for _ in 0..240 {
        s.extend_from_slice(&0u64.to_be_bytes());
    }

    // Biome palette: single-valued (bpe=0), palette=0 (plains)
    s.push(0);
    s.extend_from_slice(&write_varint(0));
    // No data array length

    s
}

fn build_light_data() -> Vec<u8> {
    let mut p = Vec::new();

    // Sky Light Mask: BitSet — 1 long with bits 0-25 set (26 sections including +2 padding)
    let sky_mask: i64 = (1i64 << 26) - 1; // bits 0..25
    p.extend_from_slice(&write_varint(1)); // length of BitSet (1 long)
    p.extend_from_slice(&sky_mask.to_be_bytes());

    // Block Light Mask: empty BitSet
    p.extend_from_slice(&write_varint(0));

    // Empty Sky Light Mask: empty BitSet
    p.extend_from_slice(&write_varint(0));

    // Empty Block Light Mask: BitSet with bits 0-25
    p.extend_from_slice(&write_varint(1));
    p.extend_from_slice(&sky_mask.to_be_bytes());

    // Sky Light arrays: 26 arrays of 2048 bytes (all 0xFF)
    p.extend_from_slice(&write_varint(26));
    let full_light = vec![0xFFu8; 2048];
    for _ in 0..26 {
        p.extend_from_slice(&write_varint(2048));
        p.extend_from_slice(&full_light);
    }

    // Block Light arrays: 0 arrays
    p.extend_from_slice(&write_varint(0));

    p
}

fn build_chunk_batch_finished(count: i32) -> Vec<u8> {
    write_varint(count)
}

fn build_sync_player_position() -> Vec<u8> {
    let mut p = Vec::new();

    // Teleport ID (VarInt)
    p.extend_from_slice(&write_varint(1));
    // X (f64)
    p.extend_from_slice(&8.0f64.to_be_bytes());
    // Y (f64) — one block above platform
    p.extend_from_slice(&66.0f64.to_be_bytes());
    // Z (f64)
    p.extend_from_slice(&8.0f64.to_be_bytes());
    // Delta X (f64)
    p.extend_from_slice(&0.0f64.to_be_bytes());
    // Delta Y (f64)
    p.extend_from_slice(&0.0f64.to_be_bytes());
    // Delta Z (f64)
    p.extend_from_slice(&0.0f64.to_be_bytes());
    // Yaw (f32)
    p.extend_from_slice(&0.0f32.to_be_bytes());
    // Pitch (f32)
    p.extend_from_slice(&0.0f32.to_be_bytes());
    // Flags (u32) — all absolute
    p.extend_from_slice(&0u32.to_be_bytes());

    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_position() {
        let pos = encode_position(8, 65, 8);
        // Decode back to verify
        let x = (pos >> 38) as i32;
        let z = ((pos >> 12) & 0x3FFFFFF) as i32;
        let y = (pos & 0xFFF) as i32;
        assert_eq!(x, 8);
        assert_eq!(y, 65);
        assert_eq!(z, 8);
    }

    #[test]
    fn test_empty_section_size() {
        let section = build_empty_section();
        // 2 (block_count) + 1 (bpe) + 1 (palette) + 1 (biome_bpe) + 1 (biome_palette) = 6
        // No data array lengths in 1.21.5+ (protocol 770+)
        assert_eq!(section.len(), 6);
    }

    #[test]
    fn test_platform_section_has_correct_data_length() {
        let section = build_platform_section();
        // Should contain 256 longs (2048 bytes) of block data + overhead
        assert!(section.len() > 2048);
    }

    #[test]
    fn test_heightmap_packing() {
        let longs = pack_heightmap_longs(129, 256, 9);
        // 7 entries per long, ceil(256/7) = 37 longs
        assert_eq!(longs.len(), 37);
        // First entry of first long should be 129
        let first = longs[0] as u64;
        assert_eq!(first & 0x1FF, 129);
    }

    #[test]
    fn test_build_play_packets_produces_bytes() {
        let packets = build_play_packets(1, 256);
        // Should produce a substantial amount of data (compressed)
        assert!(packets.len() > 100, "Got {} bytes", packets.len());
    }
}
