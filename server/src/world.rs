/// Builds Play state initialization packets for spawning a player.
/// Provides both monolithic (build_play_packets) and split APIs for worker-based chunk generation.

use crate::compression::compress_packet;
use crate::protocol::types::{write_string, write_varint};
use std::collections::HashMap;

/// Build the init packets sent before chunks.
pub fn build_play_init(
    entity_id: i32,
    threshold: i32,
    uuid: &str,
    username: &str,
    properties: &[(String, String, Option<String>)],
    fly_speed: f32,
    view_distance: i32,
) -> Vec<u8> {
    let mut result = Vec::new();
    result.extend_from_slice(&compress_packet(0x30, &build_login_play(entity_id, view_distance), threshold));
    result.extend_from_slice(&compress_packet(0x26, &build_game_event(13, 0.0), threshold));
    result.extend_from_slice(&compress_packet(0x5F, &build_set_default_spawn(), threshold));
    // Player Abilities (0x3E) — creative mode with fly enabled
    result.extend_from_slice(&compress_packet(0x3E, &build_player_abilities(fly_speed, false), threshold));
    // Player Info Update (0x44) — add player to tab list
    result.extend_from_slice(&compress_packet(0x44, &build_player_info_update(uuid, username, properties), threshold));
    // Commands (0x10) — command tree for tab completion
    result.extend_from_slice(&compress_packet(0x10, &build_commands(), threshold));
    // Set Time (0x6F) — noon, time progresses naturally
    result.extend_from_slice(&compress_packet(0x6F, &build_set_time(0, 6000, true), threshold));
    // View position (chunk batch start is sent by the worker before chunks)
    result.extend_from_slice(&compress_packet(0x5C, &build_update_view_position(), threshold));
    result
}

/// Build a single Chunk Data packet from a flat block state array.
/// `block_states` has 98304 entries (16×384×16), indexed `y_offset * 256 + z * 16 + x`
/// where y_offset ranges 0..384 (corresponding to Y=-64..+319).
pub fn build_chunk_from_blocks(cx: i32, cz: i32, block_states: &[u16], threshold: i32) -> Vec<u8> {
    compress_packet(0x2C, &build_chunk_data_from_blocks(cx, cz, block_states), threshold)
}

/// Build finish packets: Chunk Batch Finished + Synchronize Player Position (initial spawn only).
pub fn build_play_finish(chunk_count: i32, threshold: i32) -> Vec<u8> {
    let mut result = Vec::new();
    result.extend_from_slice(&compress_packet(0x0B, &build_chunk_batch_finished(chunk_count), threshold));
    result.extend_from_slice(&compress_packet(0x46, &build_sync_player_position(), threshold));
    result
}

/// Build just the Chunk Batch Finished packet (for ongoing chunk loading, no teleport).
pub fn build_chunk_batch_end(chunk_count: i32, threshold: i32) -> Vec<u8> {
    compress_packet(0x0B, &build_chunk_batch_finished(chunk_count), threshold)
}

/// Build all Play initialization packets as concatenated compressed bytes.
/// (Legacy monolithic API — kept for tests and backward compat)
pub fn build_play_packets(entity_id: i32, threshold: i32) -> Vec<u8> {
    let mut result = Vec::new();

    // 1. Login Play (0x30)
    result.extend_from_slice(&compress_packet(0x30, &build_login_play(entity_id, 10), threshold));

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

fn build_login_play(entity_id: i32, view_distance: i32) -> Vec<u8> {
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
    p.extend_from_slice(&write_varint(view_distance));
    // Simulation Distance (VarInt)
    p.extend_from_slice(&write_varint(view_distance));
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

/// Build a full chunk data payload from a flat block state array (98304 entries).
fn build_chunk_data_from_blocks(cx: i32, cz: i32, block_states: &[u16]) -> Vec<u8> {
    let mut p = Vec::new();

    // Chunk X, Z (i32)
    p.extend_from_slice(&cx.to_be_bytes());
    p.extend_from_slice(&cz.to_be_bytes());

    // Compute heightmaps by scanning for highest non-air block per column
    let mut heights = [0u64; 256]; // 16x16
    for x in 0..16usize {
        for z in 0..16usize {
            let col_idx = z * 16 + x;
            for y_off in (0..384usize).rev() {
                let idx = y_off * 256 + col_idx;
                if idx < block_states.len() && block_states[idx] != 0 {
                    // Heightmap value = y+1 from world bottom (-64), so y_off+1
                    heights[col_idx] = (y_off + 1) as u64;
                    break;
                }
            }
        }
    }
    p.extend_from_slice(&build_heightmaps_from_values(&heights));

    // Build chunk sections
    let mut section_data = Vec::new();
    for section_idx in 0..24usize {
        let y_start = section_idx * 16;
        section_data.extend_from_slice(&build_section_from_blocks(block_states, y_start));
    }
    p.extend_from_slice(&write_varint(section_data.len() as i32));
    p.extend_from_slice(&section_data);

    // Block entities: count = 0
    p.extend_from_slice(&write_varint(0));

    // Light data
    p.extend_from_slice(&build_light_data());

    p
}

/// Build a single chunk section from the block state array.
/// `y_start` is the y-offset (0-based) of the first block in this section.
fn build_section_from_blocks(block_states: &[u16], y_start: usize) -> Vec<u8> {
    let mut s = Vec::new();

    // Extract 4096 block states for this section
    let mut section_blocks = [0u16; 4096];
    let mut non_air = 0u16;
    for y in 0..16usize {
        for z in 0..16usize {
            for x in 0..16usize {
                let src_idx = (y_start + y) * 256 + z * 16 + x;
                let dst_idx = y * 256 + z * 16 + x;
                let block = if src_idx < block_states.len() { block_states[src_idx] } else { 0 };
                section_blocks[dst_idx] = block;
                if block != 0 {
                    non_air += 1;
                }
            }
        }
    }

    // Block count
    s.extend_from_slice(&non_air.to_be_bytes());

    // Build palette: unique block state IDs
    let mut palette_map: HashMap<u16, usize> = HashMap::new();
    let mut palette_list: Vec<u16> = Vec::new();
    for &block in &section_blocks {
        if !palette_map.contains_key(&block) {
            palette_map.insert(block, palette_list.len());
            palette_list.push(block);
        }
    }

    let unique_count = palette_list.len();

    if unique_count == 1 {
        // Single-value palette (bpe=0)
        s.push(0);
        s.extend_from_slice(&write_varint(palette_list[0] as i32));
    } else {
        // Choose bits_per_entry: minimum 4 for indirect palette
        let bpe = if unique_count <= 16 {
            4u8
        } else if unique_count <= 256 {
            8u8
        } else {
            15u8 // direct palette
        };

        if bpe == 15 {
            // Direct palette: no palette list, block state IDs stored directly
            s.push(15);
            // Pack section_blocks directly at 15 bpe
            let entries_per_long = 64 / bpe as usize;
            let num_longs = (4096 + entries_per_long - 1) / entries_per_long;
            for i in 0..num_longs {
                let mut long_val: u64 = 0;
                for j in 0..entries_per_long {
                    let idx = i * entries_per_long + j;
                    if idx < 4096 {
                        long_val |= (section_blocks[idx] as u64) << (j * bpe as usize);
                    }
                }
                s.extend_from_slice(&(long_val as i64).to_be_bytes());
            }
        } else {
            // Indirect palette
            s.push(bpe);
            s.extend_from_slice(&write_varint(palette_list.len() as i32));
            for &id in &palette_list {
                s.extend_from_slice(&write_varint(id as i32));
            }

            let entries_per_long = 64 / bpe as usize;
            let num_longs = (4096 + entries_per_long - 1) / entries_per_long;
            // No data array length VarInt — removed in 1.21.5+ (protocol 770+)
            for i in 0..num_longs {
                let mut long_val: u64 = 0;
                for j in 0..entries_per_long {
                    let idx = i * entries_per_long + j;
                    if idx < 4096 {
                        let palette_idx = palette_map[&section_blocks[idx]] as u64;
                        long_val |= palette_idx << (j * bpe as usize);
                    }
                }
                s.extend_from_slice(&(long_val as i64).to_be_bytes());
            }
        }
    }

    // Biome palette: single-valued (bpe=0), palette=0 (plains)
    s.push(0);
    s.extend_from_slice(&write_varint(0));
    // No data array length

    s
}

/// Build heightmaps from per-column height values (256 entries).
fn build_heightmaps_from_values(heights: &[u64; 256]) -> Vec<u8> {
    let bits_per_entry = 9;
    let entries_per_long = 64 / bits_per_entry; // 7
    let num_longs = (256 + entries_per_long - 1) / entries_per_long; // 37
    let mask = (1u64 << bits_per_entry) - 1;

    let mut longs = Vec::with_capacity(num_longs);
    let mut idx = 0;
    for _ in 0..num_longs {
        let mut long_val: u64 = 0;
        for j in 0..entries_per_long {
            if idx < 256 {
                long_val |= (heights[idx] & mask) << (j * bits_per_entry);
                idx += 1;
            }
        }
        longs.push(long_val as i64);
    }

    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(2)); // 2 heightmap entries

    // WORLD_SURFACE (type=1)
    p.extend_from_slice(&write_varint(1));
    p.extend_from_slice(&write_varint(longs.len() as i32));
    for &val in &longs {
        p.extend_from_slice(&val.to_be_bytes());
    }

    // MOTION_BLOCKING (type=4)
    p.extend_from_slice(&write_varint(4));
    p.extend_from_slice(&write_varint(longs.len() as i32));
    for &val in &longs {
        p.extend_from_slice(&val.to_be_bytes());
    }

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

/// Build Player Info Update (0x44) payload — adds player to tab list.
pub fn build_player_info_update(uuid: &str, username: &str, properties: &[(String, String, Option<String>)]) -> Vec<u8> {
    let mut p = Vec::new();

    // Actions bitmask: Add Player (0x01) | Update Game Mode (0x04) | Update Listed (0x08) | Update Latency (0x10)
    p.push(0x1D_u8);

    // Number of players
    p.extend_from_slice(&write_varint(1));

    // UUID (16 bytes)
    let uuid_hex: String = uuid.chars().filter(|c| *c != '-').collect();
    if uuid_hex.len() == 32 {
        for i in 0..16 {
            let byte = u8::from_str_radix(&uuid_hex[i*2..i*2+2], 16).unwrap_or(0);
            p.push(byte);
        }
    } else {
        p.extend_from_slice(&[0u8; 16]);
    }

    // Add Player: Name + Properties
    p.extend_from_slice(&write_string(username));
    p.extend_from_slice(&write_varint(properties.len() as i32));
    for (name, value, signature) in properties {
        p.extend_from_slice(&write_string(name));
        p.extend_from_slice(&write_string(value));
        if let Some(sig) = signature {
            p.push(1); // is_signed = true
            p.extend_from_slice(&write_string(sig));
        } else {
            p.push(0);
        }
    }

    // Update Game Mode: Creative (1)
    p.extend_from_slice(&write_varint(1));

    // Update Listed: true
    p.push(1);

    // Update Latency: 0ms
    p.extend_from_slice(&write_varint(0));

    p
}

/// Build Commands (0x10) payload — Brigadier command tree for tab completion.
pub fn build_commands() -> Vec<u8> {
    let mut p = Vec::new();

    // Node count: 16
    p.extend_from_slice(&write_varint(16));

    // Node 0: Root
    p.push(0x00); // type=root
    p.extend_from_slice(&write_varint(5)); // 5 children
    p.extend_from_slice(&write_varint(1)); // speed
    p.extend_from_slice(&write_varint(3)); // help
    p.extend_from_slice(&write_varint(4)); // time
    p.extend_from_slice(&write_varint(10)); // fly
    p.extend_from_slice(&write_varint(11)); // tp

    // Node 1: Literal "speed"
    p.push(0x01); // type=literal
    p.extend_from_slice(&write_varint(1)); // 1 child
    p.extend_from_slice(&write_varint(2));
    p.extend_from_slice(&write_string("speed"));

    // Node 2: Argument "value" float(0.0, 10.0), executable
    p.push(0x04 | 0x02); // type=argument + executable
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("value"));
    p.extend_from_slice(&write_varint(1)); // parser=float
    p.push(0x03); // flags: has_min + has_max
    p.extend_from_slice(&0.0f32.to_be_bytes());
    p.extend_from_slice(&10.0f32.to_be_bytes());

    // Node 3: Literal "help", executable
    p.push(0x04 | 0x01); // type=literal + executable
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("help"));

    // Node 4: Literal "time"
    p.push(0x01); // type=literal
    p.extend_from_slice(&write_varint(5)); // 5 children
    p.extend_from_slice(&write_varint(5)); // day
    p.extend_from_slice(&write_varint(6)); // night
    p.extend_from_slice(&write_varint(7)); // noon
    p.extend_from_slice(&write_varint(8)); // midnight
    p.extend_from_slice(&write_varint(9)); // ticks
    p.extend_from_slice(&write_string("time"));

    // Node 5: Literal "day", executable
    p.push(0x04 | 0x01);
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("day"));

    // Node 6: Literal "night", executable
    p.push(0x04 | 0x01);
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("night"));

    // Node 7: Literal "noon", executable
    p.push(0x04 | 0x01);
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("noon"));

    // Node 8: Literal "midnight", executable
    p.push(0x04 | 0x01);
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("midnight"));

    // Node 9: Argument "ticks" integer(0, 24000), executable
    p.push(0x04 | 0x02); // type=argument + executable
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("ticks"));
    p.extend_from_slice(&write_varint(3)); // parser=integer
    p.push(0x03); // flags: has_min + has_max
    p.extend_from_slice(&0i32.to_be_bytes());
    p.extend_from_slice(&24000i32.to_be_bytes());

    // Node 10: Literal "fly", executable
    p.push(0x04 | 0x01);
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("fly"));

    // Node 11: Literal "tp"
    p.push(0x01); // type=literal
    p.extend_from_slice(&write_varint(2)); // 2 children: player name OR x coord
    p.extend_from_slice(&write_varint(12)); // x
    p.extend_from_slice(&write_varint(15)); // player
    p.extend_from_slice(&write_string("tp"));

    // Node 12: Argument "x" double
    p.push(0x02); // type=argument
    p.extend_from_slice(&write_varint(1)); // 1 child
    p.extend_from_slice(&write_varint(13)); // y
    p.extend_from_slice(&write_string("x"));
    p.extend_from_slice(&write_varint(6)); // parser=double
    p.push(0x00); // no min/max flags

    // Node 13: Argument "y" double
    p.push(0x02); // type=argument
    p.extend_from_slice(&write_varint(1)); // 1 child
    p.extend_from_slice(&write_varint(14)); // z
    p.extend_from_slice(&write_string("y"));
    p.extend_from_slice(&write_varint(6)); // parser=double
    p.push(0x00);

    // Node 14: Argument "z" double, executable
    p.push(0x04 | 0x02); // type=argument + executable
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("z"));
    p.extend_from_slice(&write_varint(6)); // parser=double
    p.push(0x00);

    // Node 15: Argument "player" (game_profile — gives player name tab-completion), executable
    p.push(0x04 | 0x02); // type=argument + executable
    p.extend_from_slice(&write_varint(0));
    p.extend_from_slice(&write_string("player"));
    p.extend_from_slice(&write_varint(7)); // parser=game_profile (no extra data)

    // Root index
    p.extend_from_slice(&write_varint(0));

    p
}

/// Build Set Time (0x6F) payload.
pub fn build_set_time(world_age: i64, time_of_day: i64, increasing: bool) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&world_age.to_be_bytes());
    p.extend_from_slice(&time_of_day.to_be_bytes());
    p.push(if increasing { 1 } else { 0 });
    p
}

/// Build Player Abilities (0x3E) payload.
pub fn build_player_abilities(fly_speed: f32, is_flying: bool) -> Vec<u8> {
    let mut p = Vec::new();
    // Flags: invulnerable (0x01) | allow_flying (0x04) | creative_mode (0x08) | maybe flying (0x02)
    let mut flags: u8 = 0x01 | 0x04 | 0x08;
    if is_flying {
        flags |= 0x02;
    }
    p.push(flags as u8);
    p.extend_from_slice(&fly_speed.to_be_bytes()); // Flying Speed
    p.extend_from_slice(&0.1f32.to_be_bytes()); // FOV Modifier
    p
}

/// Build a System Chat Message payload (NBT TAG_String + overlay bool).
pub fn build_system_chat_payload(message: &str) -> Vec<u8> {
    let bytes = message.as_bytes();
    let mut payload = Vec::with_capacity(1 + 2 + bytes.len() + 1);
    payload.push(0x08); // TAG_String type byte
    payload.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    payload.extend_from_slice(bytes);
    payload.push(0); // overlay = false
    payload
}

/// Build Spawn Entity (0x01) payload for a player entity.
/// Entity type 128 = minecraft:player (protocol 774).
pub fn build_spawn_entity_payload(entity_id: i32, uuid: &str, x: f64, y: f64, z: f64, yaw: f32, pitch: f32) -> Vec<u8> {
    let mut p = Vec::new();
    // Entity ID (VarInt)
    p.extend_from_slice(&write_varint(entity_id));
    // Entity UUID (16 bytes)
    let uuid_hex: String = uuid.chars().filter(|c| *c != '-').collect();
    if uuid_hex.len() == 32 {
        for i in 0..16 {
            let byte = u8::from_str_radix(&uuid_hex[i*2..i*2+2], 16).unwrap_or(0);
            p.push(byte);
        }
    } else {
        p.extend_from_slice(&[0u8; 16]);
    }
    // Type (VarInt) — minecraft:player = 155 in protocol 774 (1.21.11)
    p.extend_from_slice(&write_varint(155));
    // X, Y, Z (f64)
    p.extend_from_slice(&x.to_be_bytes());
    p.extend_from_slice(&y.to_be_bytes());
    p.extend_from_slice(&z.to_be_bytes());
    // Velocity (lpVec3) — zero vector = single byte 0x00
    p.push(0x00);
    // Pitch, Yaw (angle = byte, 256/360 degrees)
    p.push(angle_to_byte(pitch));
    p.push(angle_to_byte(yaw));
    // Head Yaw (angle)
    p.push(angle_to_byte(yaw));
    // Data (VarInt) — 0 for players
    p.extend_from_slice(&write_varint(0));
    p
}

/// Build Entity Teleport (0x7b) payload.
/// Protocol 774 format: VarInt entityId, Vec3<f64> position, Vec3<f64> delta,
/// f32 yaw, f32 pitch, i32 relatives (bitfield), bool onGround
pub fn build_entity_teleport_payload(entity_id: i32, x: f64, y: f64, z: f64, yaw: f32, pitch: f32, on_ground: bool) -> Vec<u8> {
    let mut p = Vec::new();
    // Entity ID (VarInt)
    p.extend_from_slice(&write_varint(entity_id));
    // Position: X, Y, Z (f64)
    p.extend_from_slice(&x.to_be_bytes());
    p.extend_from_slice(&y.to_be_bytes());
    p.extend_from_slice(&z.to_be_bytes());
    // Delta: dX, dY, dZ (f64) — zero for absolute teleport
    p.extend_from_slice(&0.0f64.to_be_bytes());
    p.extend_from_slice(&0.0f64.to_be_bytes());
    p.extend_from_slice(&0.0f64.to_be_bytes());
    // Yaw, Pitch (f32)
    p.extend_from_slice(&yaw.to_be_bytes());
    p.extend_from_slice(&pitch.to_be_bytes());
    // Relatives (i32 bitfield) — 0 = all absolute
    p.extend_from_slice(&0i32.to_be_bytes());
    // On Ground
    p.push(if on_ground { 1 } else { 0 });
    p
}

/// Build Set Head Rotation (0x50) payload.
pub fn build_head_rotation_payload(entity_id: i32, yaw: f32) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(entity_id));
    p.push(angle_to_byte(yaw));
    p
}

/// Build Remove Entities (0x47) payload.
pub fn build_remove_entities_payload(entity_ids: &[i32]) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(entity_ids.len() as i32));
    for &id in entity_ids {
        p.extend_from_slice(&write_varint(id));
    }
    p
}

/// Build Player Info Remove payload (action=0x00 with remove flag).
/// Actually uses Player Info Update (0x44) with actions=0x00 — but the remove
/// uses a separate packet: Player Info Remove (0x43).
pub fn build_player_info_remove_payload(uuid: &str) -> Vec<u8> {
    let mut p = Vec::new();
    // Number of players
    p.extend_from_slice(&write_varint(1));
    // UUID
    let uuid_hex: String = uuid.chars().filter(|c| *c != '-').collect();
    if uuid_hex.len() == 32 {
        for i in 0..16 {
            let byte = u8::from_str_radix(&uuid_hex[i*2..i*2+2], 16).unwrap_or(0);
            p.push(byte);
        }
    } else {
        p.extend_from_slice(&[0u8; 16]);
    }
    p
}

fn angle_to_byte(degrees: f32) -> u8 {
    ((degrees / 360.0 * 256.0) as i32 & 0xFF) as u8
}

fn build_sync_player_position() -> Vec<u8> {
    build_sync_player_position_at(8.0, 66.0, 8.0, 0.0, 0.0)
}

/// Build a Synchronize Player Position (0x46) payload for arbitrary coordinates.
pub fn build_sync_player_position_at(x: f64, y: f64, z: f64, yaw: f32, pitch: f32) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&write_varint(1)); // Teleport ID
    p.extend_from_slice(&x.to_be_bytes());
    p.extend_from_slice(&y.to_be_bytes());
    p.extend_from_slice(&z.to_be_bytes());
    p.extend_from_slice(&0.0f64.to_be_bytes()); // Delta X
    p.extend_from_slice(&0.0f64.to_be_bytes()); // Delta Y
    p.extend_from_slice(&0.0f64.to_be_bytes()); // Delta Z
    p.extend_from_slice(&yaw.to_be_bytes());
    p.extend_from_slice(&pitch.to_be_bytes());
    p.extend_from_slice(&0u32.to_be_bytes()); // Flags — all absolute
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

    #[test]
    fn test_build_play_init_produces_bytes() {
        let packets = build_play_init(1, 256, "00000000000000000000000000000001", "TestPlayer", &[], 0.05, 10);
        assert!(packets.len() > 50, "Got {} bytes", packets.len());
    }

    #[test]
    fn test_build_play_finish_produces_bytes() {
        let packets = build_play_finish(25, 256);
        assert!(packets.len() > 10, "Got {} bytes", packets.len());
    }

    #[test]
    fn test_build_chunk_from_blocks_empty() {
        // All-air chunk
        let block_states = vec![0u16; 98304];
        let chunk = build_chunk_from_blocks(0, 0, &block_states, 256);
        assert!(chunk.len() > 50, "Got {} bytes", chunk.len());
    }

    #[test]
    fn test_build_chunk_from_blocks_with_platform() {
        // Flat world: stone Y=0..2, dirt Y=2..3, grass Y=3..4, air above
        let mut block_states = vec![0u16; 98304];
        let stone = 1u16;
        let dirt = 10u16;
        let grass = 9u16;
        // y_offset 0..64 is Y=-64..0, y_offset 64 is Y=0
        // Place platform at y_offset=128 (Y=64)
        for z in 0..16 {
            for x in 0..16 {
                block_states[128 * 256 + z * 16 + x] = stone;
                block_states[129 * 256 + z * 16 + x] = dirt;
                block_states[130 * 256 + z * 16 + x] = grass;
            }
        }
        let chunk = build_chunk_from_blocks(0, 0, &block_states, 256);
        assert!(chunk.len() > 100, "Got {} bytes", chunk.len());
    }

    #[test]
    fn test_section_single_value_optimization() {
        // All-air section should produce a small section
        let block_states = vec![0u16; 98304];
        let section = build_section_from_blocks(&block_states, 0);
        // Single-value: 2 (block_count) + 1 (bpe=0) + 1 (palette) + 1 (biome_bpe) + 1 (biome_palette) = 6
        assert_eq!(section.len(), 6);
    }
}
