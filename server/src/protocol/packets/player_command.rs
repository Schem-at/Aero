use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_varint;

/// SPlayerCommand (0x29) — entity actions.
/// Protocol 774 (v1.21.6+) action IDs:
/// 0=LeaveBed, 1=StartSprinting, 2=StopSprinting, 3=StartHorseJump,
/// 4=StopHorseJump, 5=OpenVehicleInventory, 6=StartFlyingElytra
pub struct PlayerCommandHandler;

const FLAG_SPRINTING: u8 = 0x08; // bit 3
const FLAG_ELYTRA: u8 = 0x80;    // bit 7

impl PacketHandler for PlayerCommandHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.is_empty() {
            return PacketResult::None;
        }

        let (_entity_id, off) = read_varint(payload);
        if payload.len() <= off {
            return PacketResult::None;
        }
        let (action, _) = read_varint(&payload[off..]);

        match action {
            1 => {
                // StartSprinting
                *ctx.entity_flags |= FLAG_SPRINTING;
                *ctx.entity_flags_dirty = true;
            }
            2 => {
                // StopSprinting
                *ctx.entity_flags &= !FLAG_SPRINTING;
                *ctx.entity_flags_dirty = true;
            }
            6 => {
                // StartFlyingElytra
                *ctx.entity_flags |= FLAG_ELYTRA;
                *ctx.entity_flags_dirty = true;
            }
            _ => {}
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Player Command"
    }

    fn silent(&self) -> bool {
        true
    }
}
