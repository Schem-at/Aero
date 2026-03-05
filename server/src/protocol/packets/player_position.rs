use crate::compression::compress_packet;
use crate::protocol::types::write_varint;
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// Handles Player Position (0x1D), Player Position & Look (0x1E),
/// Player Rotation (0x1F), and Player On Ground (0x20).
/// Tracks position for chunk loading and multiplayer broadcasting.
pub struct PlayerPositionHandler;

impl PacketHandler for PlayerPositionHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        match ctx.packet_id {
            // 0x1D: Position — x (f64), y (f64), z (f64), on_ground (bool)
            0x1D => {
                if payload.len() < 24 { return PacketResult::None; }
                let x = f64::from_be_bytes(payload[0..8].try_into().unwrap());
                let y = f64::from_be_bytes(payload[8..16].try_into().unwrap());
                let z = f64::from_be_bytes(payload[16..24].try_into().unwrap());
                *ctx.player_x = x;
                *ctx.player_y = y;
                *ctx.player_z = z;
                *ctx.position_dirty = true;
            }
            // 0x1E: Position + Rotation — x, y, z (f64), yaw (f32), pitch (f32), on_ground
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
            }
            // 0x1F: Rotation — yaw (f32), pitch (f32), on_ground
            0x1F => {
                if payload.len() < 8 { return PacketResult::None; }
                let yaw = f32::from_be_bytes(payload[0..4].try_into().unwrap());
                let pitch = f32::from_be_bytes(payload[4..8].try_into().unwrap());
                *ctx.player_yaw = yaw;
                *ctx.player_pitch = pitch;
                *ctx.position_dirty = true;
            }
            // 0x20: On Ground — on_ground (bool) only, no position change
            _ => {}
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
            let response = compress_packet(0x5C, &view_pos, threshold);

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
