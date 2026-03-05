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
        let (uuid, username, properties) = if let Some(ref ld) = ctx.login_data {
            (
                ld.player_uuid.as_deref().unwrap_or("00000000000000000000000000000000"),
                ld.username.as_str(),
                ld.properties.as_slice(),
            )
        } else {
            ("00000000000000000000000000000000", "Player", &[][..])
        };
        let init_packets = build_play_init(1, threshold, uuid, username, properties, *ctx.fly_speed, ctx.server_config.render_distance as i32);

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
