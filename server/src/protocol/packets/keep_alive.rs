use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

pub struct KeepAliveHandler;

impl PacketHandler for KeepAliveHandler {
    fn handle(&self, _payload: &[u8], _ctx: &mut HandlerContext) -> PacketResult {
        // Client echoes back our Keep Alive ID — just acknowledge, don't echo again
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Keep Alive"
    }

    fn silent(&self) -> bool { true }
}
