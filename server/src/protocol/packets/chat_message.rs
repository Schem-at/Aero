use crate::compression::compress_packet;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_string;
use crate::world;

pub struct ChatMessageHandler;

impl PacketHandler for ChatMessageHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (message, _) = read_string(payload);
        let username = ctx
            .login_data
            .as_ref()
            .map(|d| d.username.as_str())
            .unwrap_or("Unknown");

        let formatted = format!("<{}> {}", username, message);
        ctx.log(LogLevel::Info, LogCategory::Chat, &formatted);

        // Store for JS worker to broadcast to other players
        *ctx.pending_chat_broadcast = Some(formatted.clone());

        // Echo the message back to the client as System Chat
        let threshold = ctx.compression_threshold.unwrap_or(256);
        let chat = compress_packet(crate::protocol::packet_ids::clientbound::play::SYSTEM_CHAT, &world::build_system_chat_payload(&formatted), threshold);
        PacketResult::RawResponse(chat)
    }

    fn name(&self) -> &'static str {
        "Chat Message"
    }
}
