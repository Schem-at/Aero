use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_varint;

pub struct ConfirmTeleportationHandler;

impl PacketHandler for ConfirmTeleportationHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (teleport_id, _) = read_varint(payload);
        ctx.log(
            LogLevel::Debug,
            LogCategory::Protocol,
            &format!("Confirm Teleportation: id={}", teleport_id),
        );
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Confirm Teleportation"
    }
}
