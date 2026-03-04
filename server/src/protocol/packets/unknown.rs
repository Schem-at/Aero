use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::stats::hex_dump;

pub struct UnknownHandler;

impl PacketHandler for UnknownHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(
            LogLevel::Warn,
            LogCategory::Protocol,
            &format!(
                "Unknown packet 0x{:02X} ({} bytes): {}",
                ctx.packet_id,
                payload.len(),
                hex_dump(payload, 64),
            ),
        );

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Unknown"
    }
}
