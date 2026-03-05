use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::{read_string, read_varint};

pub struct ClientSettingsPlayHandler;

impl PacketHandler for ClientSettingsPlayHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        // Parse: locale (String), view_distance (u8), chat_mode (VarInt),
        //        chat_colors (bool), displayed_skin_parts (u8), ...
        let (locale, off) = read_string(payload);
        if payload.len() > off {
            let _view_distance = payload[off];
            let rest = &payload[off + 1..];
            let (_chat_mode, cm_off) = read_varint(rest);
            if rest.len() > cm_off {
                let _chat_colors = rest[cm_off];
                if rest.len() > cm_off + 1 {
                    let skin_parts = rest[cm_off + 1];
                    if skin_parts != *ctx.skin_parts {
                        *ctx.skin_parts = skin_parts;
                        *ctx.skin_parts_dirty = true;
                    }
                    ctx.log(
                        LogLevel::Debug,
                        LogCategory::Protocol,
                        &format!("Client Settings (Play): locale={}, skin_parts=0x{:02X}", locale, skin_parts),
                    );
                    return PacketResult::None;
                }
            }
        }
        ctx.log(LogLevel::Debug, LogCategory::Protocol, "Client Settings (Play)");
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Client Settings"
    }
}
