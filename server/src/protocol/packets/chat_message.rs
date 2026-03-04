use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_string;

pub struct ChatMessageHandler;

impl PacketHandler for ChatMessageHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (message, _) = read_string(payload);
        let username = ctx
            .login_data
            .as_ref()
            .map(|d| d.username.as_str())
            .unwrap_or("Unknown");
        ctx.log(
            LogLevel::Info,
            LogCategory::Chat,
            &format!("<{}> {}", username, message),
        );
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Chat Message"
    }
}
