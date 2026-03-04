use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_string;

pub struct ClientInformationHandler;

impl PacketHandler for ClientInformationHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (locale, _) = read_string(payload);
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
