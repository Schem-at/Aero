use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// Perform Respawn (0x0B) — client requests respawn after death screen.
pub struct PerformRespawnHandler;

impl PacketHandler for PerformRespawnHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        *ctx.pending_respawn = true;
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Perform Respawn"
    }
}
