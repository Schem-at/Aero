use crate::compression::compress_packet;
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// SPickItemFromBlock (0x23) — middle-click to pick block.
/// Format: position (i64 packed), include_data (bool)
/// In creative mode, we just acknowledge by sending Set Held Slot (0x67)
/// pointing to the current slot (client already placed the item).
pub struct PickItemFromBlockHandler;

impl PacketHandler for PickItemFromBlockHandler {
    fn handle(&self, _payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        // The client handles the inventory swap locally in creative mode.
        // We respond with Set Held Slot to confirm the current selected slot.
        let threshold = ctx.compression_threshold.unwrap_or(256);
        let slot_payload = [*ctx.held_slot as i8 as u8];
        PacketResult::RawResponse(compress_packet(crate::protocol::packet_ids::clientbound::play::HELD_ITEM_SLOT, &slot_payload, threshold))
    }

    fn name(&self) -> &'static str {
        "Pick Item From Block"
    }
}

/// SPickItemFromEntity (0x24) — middle-click on entity.
pub struct PickItemFromEntityHandler;

impl PacketHandler for PickItemFromEntityHandler {
    fn handle(&self, _payload: &[u8], _ctx: &mut HandlerContext) -> PacketResult {
        // Not implemented — would require spawn egg items
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Pick Item From Entity"
    }
}
