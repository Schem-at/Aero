use crate::compression::compress_packet;
use crate::connection::ConnectionState;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::write_varint;

pub struct LoginAcknowledgedHandler;

impl PacketHandler for LoginAcknowledgedHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(LogLevel::Info, LogCategory::Login, "Login Acknowledged — transitioning to Configuration state");
        *ctx.state = ConnectionState::Configuration;

        let threshold = ctx.compression_threshold.unwrap_or(256);

        // Send Known Packs (0x0E) with 0 entries — tells client we have no known packs
        let known_packs_payload = write_varint(0); // 0 known packs
        let response = compress_packet(crate::protocol::packet_ids::clientbound::configuration::SELECT_KNOWN_PACKS, &known_packs_payload, threshold);

        ctx.log(LogLevel::Info, LogCategory::Protocol, "Sent Known Packs (0 entries)");

        PacketResult::RawResponse(response)
    }

    fn name(&self) -> &'static str {
        "Login Acknowledged"
    }
}
