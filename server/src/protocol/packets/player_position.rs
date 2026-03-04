use crate::compression::compress_packet;
use crate::protocol::types::write_varint;
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// Handles Player Position (0x1D) and Player Position & Look (0x1E).
/// Tracks the player's chunk position for ongoing chunk loading.
pub struct PlayerPositionHandler;

impl PacketHandler for PlayerPositionHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        // Player Position: x (f64), y (f64), z (f64), on_ground (bool)
        // Player Position & Look: x (f64), y (f64), z (f64), yaw (f32), pitch (f32), on_ground (bool)
        if payload.len() < 24 {
            return PacketResult::None;
        }

        let x = f64::from_be_bytes([
            payload[0], payload[1], payload[2], payload[3],
            payload[4], payload[5], payload[6], payload[7],
        ]);
        let z = f64::from_be_bytes([
            payload[16], payload[17], payload[18], payload[19],
            payload[20], payload[21], payload[22], payload[23],
        ]);

        let chunk_x = (x.floor() as i32) >> 4;
        let chunk_z = (z.floor() as i32) >> 4;

        if chunk_x != *ctx.player_chunk_x || chunk_z != *ctx.player_chunk_z {
            *ctx.player_chunk_x = chunk_x;
            *ctx.player_chunk_z = chunk_z;

            // Build Update View Position (0x5C) packet + Chunk Batch Start (0x0C)
            let threshold = ctx.compression_threshold.unwrap_or(256);
            let mut response = Vec::new();

            // Update View Position — tells client to center chunk loading
            let mut view_pos = Vec::new();
            view_pos.extend_from_slice(&write_varint(chunk_x));
            view_pos.extend_from_slice(&write_varint(chunk_z));
            response.extend_from_slice(&compress_packet(0x5C, &view_pos, threshold));

            // Chunk Batch Start
            response.extend_from_slice(&compress_packet(0x0C, &[], threshold));

            // Signal that chunks need to be sent for new center
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
