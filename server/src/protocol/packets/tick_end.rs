use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

pub struct TickEndHandler;

impl PacketHandler for TickEndHandler {
    fn handle(&self, _payload: &[u8], _ctx: &mut HandlerContext) -> PacketResult {
        // tick_end is a 0-byte packet sent every client tick — silently ignore
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Tick End"
    }

    fn silent(&self) -> bool { true }
}
