use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::{read_string, read_varint};

pub struct ClientInformationHandler;

impl PacketHandler for ClientInformationHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        // Parse: locale (String), view_distance (u8), chat_mode (VarInt),
        //        chat_colors (bool), displayed_skin_parts (u8), ...
        let (locale, off) = read_string(payload);
        if payload.len() > off {
            let _view_distance = payload[off];
            let rest = &payload[off + 1..];
            let (_chat_mode, cm_off) = read_varint(rest);
            if rest.len() > cm_off + 1 {
                let skin_parts = rest[cm_off + 1];
                *ctx.skin_parts = skin_parts;
                ctx.log(
                    LogLevel::Debug,
                    LogCategory::Protocol,
                    &format!("Client Information: locale={}, skin_parts=0x{:02X}", locale, skin_parts),
                );
                return PacketResult::None;
            }
        }
        ctx.log(
            LogLevel::Debug,
            LogCategory::Protocol,
            &format!("Client Information: locale={}", locale),
        );
        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Client Information"
    }
}
