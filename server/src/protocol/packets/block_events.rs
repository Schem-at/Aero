use crate::compression::compress_packet;
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::{read_varint, write_varint};

/// A pending block event to broadcast to other players.
#[derive(Clone)]
pub struct BlockEvent {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub block_state: i32,
    pub sequence: i32,
}

/// Decode a packed block position (i64) into (x, y, z).
fn decode_position(val: i64) -> (i32, i32, i32) {
    let mut x = (val >> 38) as i32;
    let mut z = ((val >> 12) & 0x3FFFFFF) as i32;
    let mut y = (val & 0xFFF) as i32;
    // Sign-extend
    if x >= 1 << 25 { x -= 1 << 26; }
    if z >= 1 << 25 { z -= 1 << 26; }
    if y >= 1 << 11 { y -= 1 << 12; }
    (x, y, z)
}

/// Compute the adjacent block position based on face direction.
fn offset_by_face(x: i32, y: i32, z: i32, face: i32) -> (i32, i32, i32) {
    match face {
        0 => (x, y - 1, z), // Bottom
        1 => (x, y + 1, z), // Top
        2 => (x, y, z - 1), // North
        3 => (x, y, z + 1), // South
        4 => (x - 1, y, z), // West
        5 => (x + 1, y, z), // East
        _ => (x, y, z),
    }
}

// ---------------------------------------------------------------------------
// Player Action (0x28) — block breaking
// ---------------------------------------------------------------------------

pub struct PlayerActionHandler;

impl PacketHandler for PlayerActionHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() < 2 {
            return PacketResult::None;
        }

        let (status, off) = read_varint(payload);

        // Status 1 = Cancelled Digging, 3 = Drop item stack, 4 = Drop item,
        // 5 = Release Use Item (bow/eat), 6 = Swap Item In Hand
        if status == 1 || status == 3 || status == 4 || status == 5 || status == 6 {
            return PacketResult::None;
        }

        // Status 0 = Started Digging (instant break in creative mode)
        // Status 2 = Finished Digging (survival mode completed mining)
        if status != 0 && status != 2 {
            return PacketResult::None;
        }

        if payload.len() < off + 8 {
            return PacketResult::None;
        }

        let pos_val = i64::from_be_bytes(payload[off..off + 8].try_into().unwrap());
        let (x, y, z) = decode_position(pos_val);

        let rest = &payload[off + 8..];
        let _face = if !rest.is_empty() { rest[0] } else { 0 };
        let (sequence, _) = if rest.len() > 1 {
            read_varint(&rest[1..])
        } else {
            (0, 0)
        };

        // Store block break event (block_state = 0 = air)
        ctx.pending_block_events.push(BlockEvent {
            x,
            y,
            z,
            block_state: 0,
            sequence,
        });

        // Send Block Changed Ack to the breaking player
        let threshold = ctx.compression_threshold.unwrap_or(256);
        let ack = compress_packet(crate::protocol::packet_ids::clientbound::play::ACKNOWLEDGE_PLAYER_DIGGING, &write_varint(sequence), threshold);
        PacketResult::RawResponse(ack)
    }

    fn name(&self) -> &'static str {
        "Player Action"
    }
}

// ---------------------------------------------------------------------------
// Use Item On (0x3F) — block placement
// ---------------------------------------------------------------------------

pub struct UseItemOnHandler;

impl PacketHandler for UseItemOnHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() < 1 {
            return PacketResult::None;
        }

        let (hand, off) = read_varint(payload);
        // Only main hand (0) placements
        if hand != 0 || payload.len() < off + 8 {
            // Still need to ack even for off-hand
            // Try to read sequence at end
            return PacketResult::None;
        }

        let pos_val = i64::from_be_bytes(payload[off..off + 8].try_into().unwrap());
        let (bx, by, bz) = decode_position(pos_val);

        let rest = &payload[off + 8..];
        let (face, face_off) = read_varint(rest);

        // Skip cursor_pos (3 x f32 = 12 bytes) + inside_block (1) + against_world_border (1)
        let skip = face_off + 12 + 1 + 1;
        let (sequence, _) = if rest.len() > skip {
            read_varint(&rest[skip..])
        } else {
            (0, 0)
        };

        // Calculate target position (adjacent to clicked block)
        let (tx, ty, tz) = offset_by_face(bx, by, bz, face);

        // Get the block state for the held item
        let slot = *ctx.held_slot as usize;
        let item_id = ctx.hotbar_items[slot.min(8)];
        let block_state = *ctx.item_to_block.get(&item_id).unwrap_or(&1); // default to stone

        if block_state <= 0 {
            // Not a placeable block
            return PacketResult::None;
        }

        ctx.pending_block_events.push(BlockEvent {
            x: tx,
            y: ty,
            z: tz,
            block_state,
            sequence,
        });

        // Send Block Changed Ack to the placing player
        let threshold = ctx.compression_threshold.unwrap_or(256);
        let ack = compress_packet(crate::protocol::packet_ids::clientbound::play::ACKNOWLEDGE_PLAYER_DIGGING, &write_varint(sequence), threshold);
        PacketResult::RawResponse(ack)
    }

    fn name(&self) -> &'static str {
        "Use Item On"
    }
}

// ---------------------------------------------------------------------------
// Set Held Item (0x34) — track which hotbar slot is selected
// ---------------------------------------------------------------------------

pub struct SetHeldItemHandler;

impl PacketHandler for SetHeldItemHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() >= 2 {
            let slot = i16::from_be_bytes([payload[0], payload[1]]);
            if (0..9).contains(&slot) {
                *ctx.held_slot = slot as u8;
                *ctx.held_item_dirty = true;
            }
        }
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Set Held Item"
    }

    fn silent(&self) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// Set Creative Mode Slot — track hotbar item IDs
// ---------------------------------------------------------------------------

pub struct SetCreativeSlotHandler;

impl PacketHandler for SetCreativeSlotHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() < 3 {
            return PacketResult::None;
        }

        let slot = i16::from_be_bytes([payload[0], payload[1]]);
        // Hotbar is slots 36-44 in the player inventory
        let hotbar_index = slot - 36;
        if !(0..9).contains(&hotbar_index) {
            return PacketResult::None;
        }

        // Read item: count (VarInt), if > 0: item_id (VarInt)
        let (count, off) = read_varint(&payload[2..]);
        if count > 0 && payload.len() > 2 + off {
            let (item_id, _) = read_varint(&payload[2 + off..]);
            ctx.hotbar_items[hotbar_index as usize] = item_id;
        } else {
            ctx.hotbar_items[hotbar_index as usize] = 0; // empty
        }

        // If the changed slot is the currently held slot, mark equipment dirty
        if hotbar_index as u8 == *ctx.held_slot {
            *ctx.held_item_dirty = true;
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Set Creative Slot"
    }
}

/// Build a Block Update (0x08) payload: position (i64) + block_state_id (VarInt).
pub fn build_block_update_payload(x: i32, y: i32, z: i32, block_state: i32) -> Vec<u8> {
    let pos = ((x as i64 & 0x3FFFFFF) << 38) | ((z as i64 & 0x3FFFFFF) << 12) | (y as i64 & 0xFFF);
    let mut p = Vec::new();
    p.extend_from_slice(&pos.to_be_bytes());
    p.extend_from_slice(&write_varint(block_state));
    p
}
