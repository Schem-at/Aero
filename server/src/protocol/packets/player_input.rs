use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// SPlayerInput (0x2A) — bitflag input state (protocol 774+).
/// Bits: 0=forward, 1=backward, 2=left, 3=right, 4=jump, 5=sneak, 6=sprint
pub struct PlayerInputHandler;

const SNEAK_BIT: u8 = 0x20;
const SPRINT_BIT: u8 = 0x40;

// Entity flags byte (metadata index 0)
const FLAG_SNEAKING: u8 = 0x02; // bit 1
const FLAG_SPRINTING: u8 = 0x08; // bit 3

impl PacketHandler for PlayerInputHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        if payload.is_empty() {
            return PacketResult::None;
        }

        let input = payload[0];
        let sneaking = input & SNEAK_BIT != 0;
        let sprinting = input & SPRINT_BIT != 0;

        let mut new_flags = *ctx.entity_flags;
        if sneaking {
            new_flags |= FLAG_SNEAKING;
        } else {
            new_flags &= !FLAG_SNEAKING;
        }
        if sprinting {
            new_flags |= FLAG_SPRINTING;
        } else {
            new_flags &= !FLAG_SPRINTING;
        }

        let new_pose = if sneaking { 5u8 } else { 0u8 }; // Crouching=5, Standing=0

        if new_flags != *ctx.entity_flags || new_pose != *ctx.entity_pose {
            *ctx.entity_flags = new_flags;
            *ctx.entity_pose = new_pose;
            *ctx.entity_flags_dirty = true;
        }

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Player Input"
    }

    fn silent(&self) -> bool {
        true
    }
}
