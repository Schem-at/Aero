use crate::connection::ConnectionState;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::packet::frame_packet;
use crate::protocol::slp::build_pong;

pub struct PingHandler;

impl PacketHandler for PingHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() < 8 {
            ctx.log(LogLevel::Error, LogCategory::Ping, "Ping packet too short");
            return PacketResult::None;
        }

        let ping_value = i64::from_be_bytes(payload[..8].try_into().unwrap());
        ctx.log(
            LogLevel::Info,
            LogCategory::Ping,
            &format!("Ping received (payload={})", ping_value),
        );

        let pong_payload = build_pong(ping_value);
        let framed = frame_packet(0x01, &pong_payload);

        ctx.log(
            LogLevel::Info,
            LogCategory::Ping,
            &format!("Sending Pong response ({} bytes)", framed.len()),
        );

        // After ping/pong, reset for next connection
        *ctx.state = ConnectionState::Handshaking;
        ctx.log(LogLevel::Debug, LogCategory::Protocol, "Connection complete, resetting state");

        PacketResult::Response(framed)
    }

    fn name(&self) -> &'static str {
        "Ping"
    }
}
