use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_varint;
use crate::logging::{LogCategory, LogLevel};

/// SInteract (0x19) — player interacts with an entity.
/// Format: entity_id (VarInt), type (VarInt: 0=Interact, 1=Attack, 2=InteractAt), ...
pub struct InteractHandler;

impl PacketHandler for InteractHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.len() < 2 {
            return PacketResult::None;
        }

        let (entity_id, off) = read_varint(payload);
        if payload.len() <= off {
            return PacketResult::None;
        }
        let (action_type, _) = read_varint(&payload[off..]);

        if action_type == 1 {
            // Attack
            ctx.log(
                LogLevel::Debug,
                LogCategory::Protocol,
                &format!("Interact: attack entity {}", entity_id),
            );
            ctx.pending_attacks.push(entity_id);
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Interact"
    }
}
