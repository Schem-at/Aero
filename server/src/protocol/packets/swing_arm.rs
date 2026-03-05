use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// Swing Arm (0x3C) — player swings their arm (punch animation).
pub struct SwingArmHandler;

impl PacketHandler for SwingArmHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        *ctx.pending_swing = true;
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Swing Arm"
    }

    fn silent(&self) -> bool {
        true
    }
}
