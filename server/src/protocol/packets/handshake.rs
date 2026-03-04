use crate::connection::ConnectionState;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::slp::parse_handshake;

pub struct HandshakeHandler;

impl PacketHandler for HandshakeHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let hs = parse_handshake(payload);
        ctx.log(
            LogLevel::Info,
            LogCategory::Handshake,
            &format!(
                "Handshake received: protocol={}, server={}:{}, next_state={}",
                hs.protocol_version, hs.server_address, hs.server_port, hs.next_state
            ),
        );

        *ctx.protocol_version = hs.protocol_version;

        match hs.next_state {
            1 => {
                *ctx.state = ConnectionState::Status;
                ctx.log(LogLevel::Info, LogCategory::Protocol, "Transitioning to Status state");
            }
            2 => {
                *ctx.state = ConnectionState::Login;
                ctx.log(LogLevel::Info, LogCategory::Protocol, "Transitioning to Login state");
            }
            other => {
                ctx.log(
                    LogLevel::Warn,
                    LogCategory::Protocol,
                    &format!("Unsupported next_state: {}", other),
                );
            }
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Handshake"
    }
}
