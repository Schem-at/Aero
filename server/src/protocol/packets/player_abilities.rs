use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

pub struct PlayerAbilitiesHandler;

impl PacketHandler for PlayerAbilitiesHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if !payload.is_empty() {
            let flags = payload[0];
            let flying = flags & 0x02 != 0;
            *ctx.is_flying = flying;
            ctx.log(
                LogLevel::Debug,
                LogCategory::Protocol,
                &format!("Player Abilities: flying={}", flying),
            );
        }
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Player Abilities"
    }
}
