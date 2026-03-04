use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

pub struct ClientSettingsPlayHandler;

impl PacketHandler for ClientSettingsPlayHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(LogLevel::Debug, LogCategory::Protocol, "Client Settings (Play)");
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Client Settings"
    }
}
