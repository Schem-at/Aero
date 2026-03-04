use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

pub struct ChunkBatchReceivedHandler;

impl PacketHandler for ChunkBatchReceivedHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(LogLevel::Debug, LogCategory::Protocol, "Chunk Batch Received");
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Chunk Batch Received"
    }
}
