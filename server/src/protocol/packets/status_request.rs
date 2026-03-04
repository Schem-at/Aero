use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::packet::frame_packet;
use crate::protocol::slp::build_status_response;

pub struct StatusRequestHandler;

impl PacketHandler for StatusRequestHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(LogLevel::Info, LogCategory::Status, "Status Request received");

        let config = ctx.server_config;
        let status_payload = build_status_response(
            &config.motd,
            config.max_players,
            ctx.stats.player_count,
            &config.version_name,
            *ctx.protocol_version,
            config.favicon.as_deref(),
        );
        let framed = frame_packet(0x00, &status_payload);

        ctx.log(
            LogLevel::Info,
            LogCategory::Status,
            &format!("Sending Status Response ({} bytes)", framed.len()),
        );

        PacketResult::Response(framed)
    }

    fn name(&self) -> &'static str {
        "StatusRequest"
    }
}
