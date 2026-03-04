use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_string;

pub struct PluginMessageHandler;

impl PacketHandler for PluginMessageHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (channel, _) = read_string(payload);
        ctx.log(
            LogLevel::Debug,
            LogCategory::Protocol,
            &format!("Plugin Message: channel={}", channel),
        );
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Plugin Message"
    }
}
