use crate::connection::ConnectionState;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::world::build_play_init;

pub struct AcknowledgeFinishConfigHandler;

impl PacketHandler for AcknowledgeFinishConfigHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(
            LogLevel::Info,
            LogCategory::Protocol,
            "Acknowledge Finish Configuration — transitioning to Play state",
        );
        *ctx.state = ConnectionState::Play;

        let threshold = ctx.compression_threshold.unwrap_or(256);
        let init_packets = build_play_init(1, threshold);

        *ctx.awaiting_chunks = true;

        ctx.log(
            LogLevel::Info,
            LogCategory::Protocol,
            &format!("Sent Play init packets ({} bytes), awaiting chunks from generator", init_packets.len()),
        );

        PacketResult::RawResponse(init_packets)
    }

    fn name(&self) -> &'static str {
        "Acknowledge Finish Configuration"
    }
}
