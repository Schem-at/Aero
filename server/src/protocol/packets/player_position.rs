use crate::compression::compress_packet;
use crate::protocol::types::write_varint;
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// Handles Player Position (0x1D), Player Position & Look (0x1E),
/// Player Rotation (0x1F), and Player On Ground (0x20).
/// Tracks position for chunk loading and multiplayer broadcasting.
pub struct PlayerPositionHandler;

const FLAG_ELYTRA: u8 = 0x80;

impl PacketHandler for PlayerPositionHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let mut flags_byte: u8 = 0;

        match ctx.packet_id {
            // 0x1D: Position — x (f64), y (f64), z (f64), flags (u8)
            0x1D => {
                if payload.len() < 24 { return PacketResult::None; }
                let x = f64::from_be_bytes(payload[0..8].try_into().unwrap());
                let y = f64::from_be_bytes(payload[8..16].try_into().unwrap());
                let z = f64::from_be_bytes(payload[16..24].try_into().unwrap());
                *ctx.player_x = x;
                *ctx.player_y = y;
                *ctx.player_z = z;
                *ctx.position_dirty = true;
                if payload.len() > 24 { flags_byte = payload[24]; }
            }
            // 0x1E: Position + Rotation — x, y, z (f64), yaw (f32), pitch (f32), flags (u8)
            0x1E => {
                if payload.len() < 32 { return PacketResult::None; }
                let x = f64::from_be_bytes(payload[0..8].try_into().unwrap());
                let y = f64::from_be_bytes(payload[8..16].try_into().unwrap());
                let z = f64::from_be_bytes(payload[16..24].try_into().unwrap());
                let yaw = f32::from_be_bytes(payload[24..28].try_into().unwrap());
                let pitch = f32::from_be_bytes(payload[28..32].try_into().unwrap());
                *ctx.player_x = x;
                *ctx.player_y = y;
                *ctx.player_z = z;
                *ctx.player_yaw = yaw;
                *ctx.player_pitch = pitch;
                *ctx.position_dirty = true;
                if payload.len() > 32 { flags_byte = payload[32]; }
            }
            // 0x1F: Rotation — yaw (f32), pitch (f32), flags (u8)
            0x1F => {
                if payload.len() < 8 { return PacketResult::None; }
                let yaw = f32::from_be_bytes(payload[0..4].try_into().unwrap());
                let pitch = f32::from_be_bytes(payload[4..8].try_into().unwrap());
                *ctx.player_yaw = yaw;
                *ctx.player_pitch = pitch;
                *ctx.position_dirty = true;
                if payload.len() > 8 { flags_byte = payload[8]; }
            }
            // 0x20: On Ground — flags (u8) only
            0x20 => {
                if !payload.is_empty() { flags_byte = payload[0]; }
            }
            _ => {}
        }

        let new_on_ground = flags_byte & 0x01 != 0;

        // Fall damage: detect landing after a fall
        if new_on_ground && !*ctx.on_ground {
            // Just landed — calculate fall distance
            let fall_distance = *ctx.fall_start_y - *ctx.player_y;
            if fall_distance > 3.0 && *ctx.gamemode == 0 {
                // Survival mode fall damage = fall_distance - 3
                *ctx.pending_fall_damage = (fall_distance - 3.0) as f32;
            }
        }

        if !new_on_ground && *ctx.on_ground {
            // Just left the ground — record start Y
            *ctx.fall_start_y = *ctx.player_y;
        }

        // Track highest point during fall (for cases where player goes up then down)
        if !new_on_ground && *ctx.player_y > *ctx.fall_start_y {
            *ctx.fall_start_y = *ctx.player_y;
        }

        *ctx.on_ground = new_on_ground;

        // Clear elytra flag when player touches ground
        if new_on_ground && (*ctx.entity_flags & FLAG_ELYTRA) != 0 {
            *ctx.entity_flags &= !FLAG_ELYTRA;
            *ctx.entity_flags_dirty = true;
        }

        // Check if chunk center changed
        let x = *ctx.player_x;
        let z = *ctx.player_z;
        let chunk_x = (x.floor() as i32) >> 4;
        let chunk_z = (z.floor() as i32) >> 4;

        if chunk_x != *ctx.player_chunk_x || chunk_z != *ctx.player_chunk_z {
            *ctx.player_chunk_x = chunk_x;
            *ctx.player_chunk_z = chunk_z;

            let threshold = ctx.compression_threshold.unwrap_or(256);
            let mut view_pos = Vec::new();
            view_pos.extend_from_slice(&write_varint(chunk_x));
            view_pos.extend_from_slice(&write_varint(chunk_z));
            let response = compress_packet(crate::protocol::packet_ids::clientbound::play::UPDATE_VIEW_POSITION, &view_pos, threshold);

            *ctx.pending_chunk_center = Some((chunk_x, chunk_z));
            *ctx.awaiting_chunks = true;

            return PacketResult::RawResponse(response);
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Player Position"
    }

    fn silent(&self) -> bool {
        true
    }
}
